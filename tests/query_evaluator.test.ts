import { describe, it, expect } from 'vitest';
import { QueryEvaluator, QueryBinding, AddBindingResult } from '../src/core/query_evaluator';
import { Grip } from '../src/core/grip';
import { Query, QueryBuilderFactory } from '../src/core/query';
import type { Tap, TapFactory } from '../src/core/tap';

// Helpers
const qb = () => new QueryBuilderFactory().newQuery();
const ctxWith = (entries: Array<[Grip<any>, any]>) => {
    const m = new Map<Grip<any>, any>(entries);
    return { getValue: (g: Grip<any>) => m.get(g) };
};

function makeTap(label: string, provides: readonly Grip<any>[]): Tap {
    return {
        provides,
        produce() {},
        getHomeContext() { return undefined; },
        getParamsContext() { return undefined; },
    } as unknown as Tap;
}

function makeFactory(label: string, provides: readonly Grip<any>[], counter: { n: number }): TapFactory {
    return {
        label,
        provides,
        build() {
            counter.n += 1;
            return makeTap(label + '#built', provides);
        },
    };
}

function makeEvaluator(
    useHybridEvaluation: boolean = false,
    useCache: boolean = true,
    initialBindings: QueryBinding[] = [],
    precomputationThreshold: number = 1000,
) {
    return new QueryEvaluator(initialBindings, precomputationThreshold, useHybridEvaluation, useCache);
}

// Run all tests under a settings matrix
const combos: Array<[boolean, boolean]> = [
    [false, false],
    [true, false],
    [false, true],
];

// Normalize outputs for value equality checks
function normalizeAttributedOutputs(m: Map<Grip<any>, { bindingId: string; score: number }>): Array<{ gripKey: string; bindingId: string; score: number }> {
    const arr: Array<{ gripKey: string; bindingId: string; score: number }> = [];
    for (const [grip, out] of m.entries()) {
        arr.push({ gripKey: grip.key, bindingId: out.bindingId, score: out.score });
    }
    arr.sort((a, b) => a.gripKey.localeCompare(b.gripKey) || a.bindingId.localeCompare(b.bindingId) || a.score - b.score);
    return arr;
}

// Helper to compare sets of Grips by their keys for stable assertion
function expectGripsToEqual(actual: Set<Grip<any>>, expected: Grip<any>[]) {
    const actualKeys = Array.from(actual).map(g => g.key).sort();
    const expectedKeys = expected.map(g => g.key).sort();
    expect(actualKeys).toEqual(expectedKeys);
}

// Exercise both cold and hot paths and assert identical results by value
function evalTwice(ev: QueryEvaluator, grips: Set<Grip<any>>, ctx: any) {
    const first = ev.onGripsChanged(grips, ctx);
    const second = ev.onGripsChanged(grips, ctx);
    expect(normalizeAttributedOutputs(first as any)).toEqual(normalizeAttributedOutputs(second as any));
    return second;
}

describe.each(combos)('QueryEvaluator (useCache=%s, useHybridEvaluation=%s)', (useCache, useHybridEvaluation) => {

describe('QueryEvaluator - attribution basics', () => {
    it('attributes a single matching binding to its outputs', () => {
        const out = new Grip<string>({ name: 'out' });
        const color = new Grip<string>({ name: 'color' });
        const tap = makeTap('tapA', [out]);
        const q: Query = qb().oneOf(color, 'red', 10).build();

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        const addResult = ev.addBinding({ id: 'A', query: q, tap, baseScore: 5 });
        
        expectGripsToEqual(addResult.newInputs, [color]);
        expectGripsToEqual(ev.getAllInputGrips(), [color]);

        const result = evalTwice(ev, new Set([color]), ctxWith([[color, 'red']]));
        const attr = result.get(out)!;
        expect(attr.bindingId).toBe('A');
        expect(attr.producerTap).toBe(tap);
        expect(attr.score).toBe(15);
    });

    it('independently attributes disjoint outputs', () => {
        const o1 = new Grip<string>({ name: 'o1' });
        const o2 = new Grip<string>({ name: 'o2' });
        const g = new Grip<string>({ name: 'g' });
        const t1 = makeTap('t1', [o1]);
        const t2 = makeTap('t2', [o2]);
        const q1 = qb().oneOf(g, 'x', 5).build();
        const q2 = qb().oneOf(g, 'x', 6).build();

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        const res1 = ev.addBinding({ id: 'B1', query: q1, tap: t1, baseScore: 0 });
        const res2 = ev.addBinding({ id: 'B2', query: q2, tap: t2, baseScore: 0 });

        expectGripsToEqual(res1.newInputs, [g]);
        expectGripsToEqual(res2.newInputs, []); // 'g' was already known
        expectGripsToEqual(ev.getAllInputGrips(), [g]);

        const res = evalTwice(ev, new Set([g]), ctxWith([[g, 'x']]));
        expect(res.get(o1)?.bindingId).toBe('B1');
        expect(res.get(o2)?.bindingId).toBe('B2');
    });
});

describe('QueryEvaluator - tie-breaks and partitions', () => {
    it('tie-breaks equal scores by bindingId (ascending)', () => {
        const out = new Grip<string>({ name: 'out' });
        const toggle = new Grip<boolean>({ name: 'toggle' });
        const t1 = makeTap('t1', [out]);
        const t2 = makeTap('t2', [out]);
        const q = qb().oneOf(toggle, true, 10).build();

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        // Add B1 first to ensure order of addition doesn't determine outcome
        const res1 = ev.addBinding({ id: 'B1', query: q, tap: t2, baseScore: 0 });
        const res2 = ev.addBinding({ id: 'A1', query: q, tap: t1, baseScore: 0 });

        expectGripsToEqual(res1.newInputs, [toggle]);
        expectGripsToEqual(res2.newInputs, []);
        expectGripsToEqual(ev.getAllInputGrips(), [toggle]);

        const res = evalTwice(ev, new Set([toggle]), ctxWith([[toggle, true]]));
        expect(res.get(out)?.bindingId).toBe('A1'); // A1 comes before B1 alphabetically
    });

    it('merges via overlapping outputs; removing a bridge splits and reattributes', () => {
        const o1 = new Grip<string>({ name: 'o1' });
        const o2 = new Grip<string>({ name: 'o2' });
        const gA = new Grip<string>({ name: 'gA' });
        const gB = new Grip<string>({ name: 'gB' });
        const gC = new Grip<string>({ name: 'gC' });

        const tA = makeTap('A', [o1]);
        const tB = makeTap('B', [o2]);
        const tC = makeTap('C', [o1, o2]);

        const qA = qb().oneOf(gA, 'yes', 10).build();
        const qB = qb().oneOf(gB, 'yes', 10).build();
        const qC = qb().oneOf(gC, 'yes', 15).build(); // highest

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        const resA = ev.addBinding({ id: 'A', query: qA, tap: tA, baseScore: 0 });
        const resB = ev.addBinding({ id: 'B', query: qB, tap: tB, baseScore: 0 });
        const resC = ev.addBinding({ id: 'C', query: qC, tap: tC, baseScore: 0 });
        
        expectGripsToEqual(resA.newInputs, [gA]);
        expectGripsToEqual(resB.newInputs, [gB]);
        expectGripsToEqual(resC.newInputs, [gC]);
        expectGripsToEqual(ev.getAllInputGrips(), [gA, gB, gC]);

        // All match: C should win both outputs
        let res = evalTwice(ev, new Set([gA, gB, gC]), ctxWith([[gA, 'yes'], [gB, 'yes'], [gC, 'yes']]));
        expect(res.get(o1)?.bindingId).toBe('C');
        expect(res.get(o2)?.bindingId).toBe('C');

        // Now C stops matching, expect outputs to reattribute to A and B
        res = evalTwice(ev, new Set([gC]), ctxWith([[gA, 'yes'], [gB, 'yes'], [gC, 'no']]));
        expect(res.get(o1)?.bindingId).toBe('A');
        expect(res.get(o2)?.bindingId).toBe('B');
    });
});

describe('QueryEvaluator - factories and caching', () => {
    it('builds a factory once per factory instance even with multiple matches', () => {
        const out = new Grip<string>({ name: 'out' });
        const flag = new Grip<boolean>({ name: 'flag' });
        const counter = { n: 0 };
        const factory: TapFactory = makeFactory('F', [out], counter);

        const q1 = qb().oneOf(flag, true, 10).build();
        const q2 = qb().oneOf(flag, true, 11).build();

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        const res1 = ev.addBinding({ id: 'B1', query: q1, tap: factory, baseScore: 0 });
        const res2 = ev.addBinding({ id: 'B2', query: q2, tap: factory, baseScore: 0 });

        expectGripsToEqual(res1.newInputs, [flag]);
        expectGripsToEqual(res2.newInputs, []);
        expectGripsToEqual(ev.getAllInputGrips(), [flag]);

        const res = evalTwice(ev, new Set([flag]), ctxWith([[flag, true]]));
        expect(res.get(out)).toBeTruthy();
        expect(counter.n).toBe(1);
    });
});

describe('QueryEvaluator - edge cases and incremental updates', () => {
    it('does not match queries with no conditions', () => {
        const out = new Grip<string>({ name: 'out' });
        const g = new Grip<string>({ name: 'g' });
        const tap = makeTap('t', [out]);
        const empty = new Query(new Map());

        const ev = makeEvaluator(false);
        const res1 = ev.addBinding({ id: 'E', query: empty, tap, baseScore: 100 });

        expectGripsToEqual(res1.newInputs, []);
        expectGripsToEqual(ev.getAllInputGrips(), []);

        const res = evalTwice(ev, new Set([g]), ctxWith([[g, 'anything']]));
        expect(res.get(out)).toBeUndefined();
    });

    it('removeBinding on unknown id is a no-op and returns no removed grips', () => {
        const out = new Grip<string>({ name: 'out' });
        const g = new Grip<string>({ name: 'g' });
        const tap = makeTap('t', [out]);
        const q = qb().oneOf(g, 'x', 10).build();
        const ev = makeEvaluator(false);
        ev.addBinding({ id: 'ID', query: q, tap, baseScore: 0 });

        const removeResult = ev.removeBinding('UNKNOWN'); // should not throw
        expect(removeResult.removedInputs.size).toBe(0);
        
        expectGripsToEqual(ev.getAllInputGrips(), [g]);
        
        const res = evalTwice(ev, new Set([g]), ctxWith([[g, 'x']]));
        expect(res.get(out)?.bindingId).toBe('ID');
    });

    it('removeBinding returns newly unused grips', () => {
        const g1 = new Grip<string>({ name: 'g1' });
        const g2 = new Grip<string>({ name: 'g2' });
        const g3 = new Grip<string>({ name: 'g3' });
        const out = new Grip<string>({ name: 'out' });
        const tap = makeTap('t', [out]);
        const q1 = qb().oneOf(g1, 'x').oneOf(g2, 'y').build();
        const q2 = qb().oneOf(g2, 'y').oneOf(g3, 'z').build();

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        ev.addBinding({ id: 'B1', query: q1, tap, baseScore: 0 });
        ev.addBinding({ id: 'B2', query: q2, tap, baseScore: 0 });

        expectGripsToEqual(ev.getAllInputGrips(), [g1, g2, g3]);

        // Remove B2. g2 is still used by B1, but g3 is now unused.
        const removeResult = ev.removeBinding('B2');
        expectGripsToEqual(removeResult.removedInputs, [g3]);
        expectGripsToEqual(ev.getAllInputGrips(), [g1, g2]);

        // Remove B1. g1 and g2 are now unused.
        const removeResult2 = ev.removeBinding('B1');
        expectGripsToEqual(removeResult2.removedInputs, [g1, g2]);
        expectGripsToEqual(ev.getAllInputGrips(), []);
    });

    it('updates attribution when a matched binding score changes', () => {
        const out = new Grip<string>({ name: 'out' });
        const g = new Grip<string>({ name: 'g' });
        const stronger = makeTap('strong', [out]);
        const weaker = makeTap('weak', [out]);
        const qStrong = qb().oneOf(g, 'a', 10).build();
        const qWeak = qb().oneOf(g, 'a', 9).build();

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        ev.addBinding({ id: 'S', query: qStrong, tap: stronger, baseScore: 0 });
        ev.addBinding({ id: 'W', query: qWeak, tap: weaker, baseScore: 0 });

        expectGripsToEqual(ev.getAllInputGrips(), [g]);

        let res = evalTwice(ev, new Set([g]), ctxWith([[g, 'a']]));
        expect(res.get(out)?.bindingId).toBe('S');

        // Change to make weaker become stronger
        const qWeak2 = qb().oneOf(g, 'a', 11).build();
        // Replace binding by removing and re-adding with same id but different query/score
        const removeResult = ev.removeBinding('W');
        expectGripsToEqual(removeResult.removedInputs, []); // 'g' is still used by S
        const addResult = ev.addBinding({ id: 'W', query: qWeak2, tap: weaker, baseScore: 0 });

        expectGripsToEqual(addResult.newInputs, []); // 'g' is already known
        expectGripsToEqual(ev.getAllInputGrips(), [g]);

        res = evalTwice(ev, new Set([g]), ctxWith([[g, 'a']]));
        expect(res.get(out)?.bindingId).toBe('W');
    });

    it('handles partial matches where some grips are undefined', () => {
        const out = new Grip<string>({ name: 'out' });
        const color = new Grip<string>({ name: 'color' });
        const size = new Grip<string>({ name: 'size' });
        const tap = makeTap('t', [out]);
        // Query depends on both color and size
        const q = qb().oneOf(color, 'red', 10).oneOf(size, 'L', 5).build();
        
        const ev = makeEvaluator(useHybridEvaluation, useCache);
        const addResult = ev.addBinding({ id: 'P', query: q, tap, baseScore: 0 });

        expectGripsToEqual(addResult.newInputs, [color, size]);
        expectGripsToEqual(ev.getAllInputGrips(), [color, size]);

        // Context only provides color, size is undefined. The query should not match.
        let res = evalTwice(ev, new Set([color, size]), ctxWith([[color, 'red']]));
        expect(res.get(out)).toBeUndefined();
    });

    it('handles a match disappearing when a grip value changes', () => {
        const out = new Grip<string>({ name: 'out' });
        const color = new Grip<string>({ name: 'color' });
        const tap = makeTap('t', [out]);
        const q = qb().oneOf(color, 'red', 10).build();

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        const addResult = ev.addBinding({ id: 'M', query: q, tap, baseScore: 0 });

        expectGripsToEqual(addResult.newInputs, [color]);
        expectGripsToEqual(ev.getAllInputGrips(), [color]);

        // First, it matches
        let res = evalTwice(ev, new Set([color]), ctxWith([[color, 'red']]));
        expect(res.get(out)?.bindingId).toBe('M');

        // Then, the value changes and it no longer matches
        res = evalTwice(ev, new Set([color]), ctxWith([[color, 'blue']]));
        expect(res.get(out)).toBeUndefined();
    });

    it('handles dynamic binding registration correctly', () => {
        const out = new Grip<string>({ name: 'out' });
        const g = new Grip<string>({ name: 'g' });
        const tapLow = makeTap('low', [out]);
        const tapHigh = makeTap('high', [out]);
        const q = qb().oneOf(g, 'x', 10).build();

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        // 1. Add low-scoring binding and evaluate
        const res1 = ev.addBinding({ id: 'LOW', query: q, tap: tapLow, baseScore: 0 });
        expectGripsToEqual(res1.newInputs, [g]);
        expectGripsToEqual(ev.getAllInputGrips(), [g]);
        let res = evalTwice(ev, new Set([g]), ctxWith([[g, 'x']]));
        expect(res.get(out)?.bindingId).toBe('LOW');

        // 2. Add a new, higher-scoring binding for the same query
        const res2 = ev.addBinding({ id: 'HIGH', query: q, tap: tapHigh, baseScore: 5 });
        expectGripsToEqual(res2.newInputs, []);
        expectGripsToEqual(ev.getAllInputGrips(), [g]);
        
        // 3. Re-evaluate
        res = evalTwice(ev, new Set([g]), ctxWith([[g, 'x']]));
        
        // 4. Assert the new binding wins
        expect(res.get(out)?.bindingId).toBe('HIGH');
    });
});

describe('QueryEvaluator - Complex Partition Merging', () => {
    it('should merge partitions and re-attribute correctly when a high-scoring bridge tap is added', () => {
        const g1 = new Grip<string>({ name: 'g1' });
        const g2 = new Grip<string>({ name: 'g2' });
        const g3 = new Grip<string>({ name: 'g3' });
        const o1 = new Grip<string>({ name: 'o1' });
        const o2 = new Grip<string>({ name: 'o2' });
        const o3 = new Grip<string>({ name: 'o3' });

        const tA = makeTap('A', [o1]);
        const tB = makeTap('B', [o2, o3]);
        const tC_bridge = makeTap('C_Bridge', [o1, o3]); // Overlaps with A and B

        const qA = qb().oneOf(g1, 'match', 10).build();
        const qB = qb().oneOf(g2, 'match', 10).build();
        const qC = qb().oneOf(g3, 'match', 20).build(); // Higher score

        const ev = makeEvaluator(useHybridEvaluation, useCache);
        ev.addBinding({ id: 'A', query: qA, tap: tA, baseScore: 0 });
        ev.addBinding({ id: 'B', query: qB, tap: tB, baseScore: 0 });
        
        const context = ctxWith([[g1, 'match'], [g2, 'match'], [g3, 'match']]);
        const changedGrips = new Set([g1, g2, g3]);

        // 1. Initial state: A and B are in separate output partitions
        let res = evalTwice(ev, changedGrips, context);
        expect(res.get(o1)?.bindingId).toBe('A');
        expect(res.get(o2)?.bindingId).toBe('B');
        expect(res.get(o3)?.bindingId).toBe('B');

        // 2. Add the high-scoring bridge tap
        const addResult = ev.addBinding({ id: 'C', query: qC, tap: tC_bridge, baseScore: 0 });
        expectGripsToEqual(addResult.newInputs, [g3]);
        expectGripsToEqual(ev.getAllInputGrips(), [g1, g2, g3]);

        // 3. Re-evaluate. C should now win o1 and o3 because it has a higher score.
        //    B should still win o2 because C doesn't provide it.
        res = evalTwice(ev, changedGrips, context);
        expect(res.get(o1)?.bindingId).toBe('C');
        expect(res.get(o2)?.bindingId).toBe('B');
        expect(res.get(o3)?.bindingId).toBe('C');
    });
});

// Using .skip to prevent this from running on every file change during development.
// Remove .skip to run the performance benchmark.
describe.skip('QueryEvaluator - Performance', () => {
    const NUM_QUERIES = 15;
    const NUM_ITERATIONS = 10000;

    // Setup a complex scenario
    const grips = Array.from({ length: 5 }, (_, i) => new Grip<number>({ name: `g${i}` }));
    const outGrip = new Grip<string>({ name: 'perfOut' });
    const bindings: QueryBinding[] = [];

    for (let i = 0; i < NUM_QUERIES; i++) {
        const grip1 = grips[i % grips.length];
        const grip2 = grips[(i + 1) % grips.length];
        const query = qb()
            .oneOf(grip1, i, 1)
            .oneOf(grip2, i + 1, 1)
            .build();
        const tap = makeTap(`tap${i}`, [outGrip]);
        bindings.push({ id: `perf_${i}`, query, tap, baseScore: 0 });
    }

    const context = ctxWith([
        [grips[0], 0],
        [grips[1], 1],
    ]);
    const changedGrips = new Set([grips[0], grips[1]]);

    it(`measures runtime evaluation for ${NUM_ITERATIONS} iterations`, () => {
        const ev = makeEvaluator(false, true, bindings, 10000); // Hybrid eval disabled
        const start = performance.now();
        for (let i = 0; i < NUM_ITERATIONS; i++) {
            ev.onGripsChanged(changedGrips, context);
        }
        const end = performance.now();
        const duration = end - start;
        console.log(`Runtime Evaluation (${NUM_ITERATIONS} iterations): ${duration.toFixed(2)}ms`);
        // This is a benchmark, not a functional assertion. We expect it to complete.
        expect(duration).toBeGreaterThan(0);
    });

    it(`measures hybrid evaluation for ${NUM_ITERATIONS} iterations`, () => {
        const ev = makeEvaluator(true, true, bindings, 10000); // Hybrid eval enabled
        const start = performance.now();
        for (let i = 0; i < NUM_ITERATIONS; i++) {
            ev.onGripsChanged(changedGrips, context);
        }
        const end = performance.now();
        const duration = end - start;
        console.log(`Hybrid Evaluation (${NUM_ITERATIONS} iterations): ${duration.toFixed(2)}ms`);
        // This is a benchmark, not a functional assertion. We expect it to complete.
        expect(duration).toBeGreaterThan(0);
    });
});

});
