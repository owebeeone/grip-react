import { describe, it, expect } from 'vitest';
import { QueryEvaluator, OutputAttributionEngine } from '../src/core/query_evaluator';
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

describe('QueryEvaluator - attribution basics', () => {
    it('attributes a single matching binding to its outputs', () => {
        const out = new Grip<string>({ name: 'out' });
        const color = new Grip<string>({ name: 'color' });
        const tap = makeTap('tapA', [out]);
        const q: Query = qb().oneOf(color, 'red', 10).build();

        const ev = new QueryEvaluator();
        ev.addBinding({ id: 'A', query: q, tap, baseScore: 5 });

        const result = ev.onGripsChanged(new Set([color]), ctxWith([[color, 'red']]));
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

        const ev = new QueryEvaluator();
        ev.addBinding({ id: 'B1', query: q1, tap: t1, baseScore: 0 });
        ev.addBinding({ id: 'B2', query: q2, tap: t2, baseScore: 0 });

        const res = ev.onGripsChanged(new Set([g]), ctxWith([[g, 'x']]));
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
        const q1 = qb().oneOf(toggle, true, 10).build();
        const q2 = qb().oneOf(toggle, true, 10).build();

        const ev = new QueryEvaluator();
        ev.addBinding({ id: 'A1', query: q1, tap: t1, baseScore: 0 });
        ev.addBinding({ id: 'B1', query: q2, tap: t2, baseScore: 0 });

        const res = ev.onGripsChanged(new Set([toggle]), ctxWith([[toggle, true]]));
        expect(res.get(out)?.bindingId).toBe('A1');
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

        const ev = new QueryEvaluator();
        ev.addBinding({ id: 'A', query: qA, tap: tA, baseScore: 0 });
        ev.addBinding({ id: 'B', query: qB, tap: tB, baseScore: 0 });
        ev.addBinding({ id: 'C', query: qC, tap: tC, baseScore: 0 });

        // All match: C should win both outputs
        let res = ev.onGripsChanged(new Set([gA, gB, gC]), ctxWith([[gA, 'yes'], [gB, 'yes'], [gC, 'yes']]));
        expect(res.get(o1)?.bindingId).toBe('C');
        expect(res.get(o2)?.bindingId).toBe('C');

        // Now C stops matching, expect outputs to reattribute to A and B
        res = ev.onGripsChanged(new Set([gC]), ctxWith([[gA, 'yes'], [gB, 'yes'], [gC, 'no']]));
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

        const ev = new QueryEvaluator();
        ev.addBinding({ id: 'B1', query: q1, tap: factory, baseScore: 0 });
        ev.addBinding({ id: 'B2', query: q2, tap: factory, baseScore: 0 });

        const res = ev.onGripsChanged(new Set([flag]), ctxWith([[flag, true]]));
        expect(res.get(out)).toBeTruthy();
        expect(counter.n).toBe(1);
    });
});

describe('QueryEvaluator - edge cases', () => {
    it('does not match queries with no conditions', () => {
        const out = new Grip<string>({ name: 'out' });
        const g = new Grip<string>({ name: 'g' });
        const tap = makeTap('t', [out]);
        const empty = new Query(new Map());

        const ev = new QueryEvaluator();
        ev.addBinding({ id: 'E', query: empty, tap, baseScore: 100 });

        const res = ev.onGripsChanged(new Set([g]), ctxWith([[g, 'anything']]));
        expect(res.get(out)).toBeUndefined();
    });

    it('removeBinding on unknown id is a no-op', () => {
        const out = new Grip<string>({ name: 'out' });
        const g = new Grip<string>({ name: 'g' });
        const tap = makeTap('t', [out]);
        const q = qb().oneOf(g, 'x', 10).build();
        const ev = new QueryEvaluator();
        ev.addBinding({ id: 'ID', query: q, tap, baseScore: 0 });

        ev.removeBinding('UNKNOWN'); // should not throw
        const res = ev.onGripsChanged(new Set([g]), ctxWith([[g, 'x']]));
        expect(res.get(out)?.bindingId).toBe('ID');
    });

    it('updates attribution when a matched binding score changes', () => {
        const out = new Grip<string>({ name: 'out' });
        const g = new Grip<string>({ name: 'g' });
        const stronger = makeTap('strong', [out]);
        const weaker = makeTap('weak', [out]);
        const qStrong = qb().oneOf(g, 'a', 10).build();
        const qWeak = qb().oneOf(g, 'a', 9).build();

        const ev = new QueryEvaluator();
        ev.addBinding({ id: 'S', query: qStrong, tap: stronger, baseScore: 0 });
        ev.addBinding({ id: 'W', query: qWeak, tap: weaker, baseScore: 0 });

        let res = ev.onGripsChanged(new Set([g]), ctxWith([[g, 'a']]));
        expect(res.get(out)?.bindingId).toBe('S');

        // Change to make weaker become stronger
        const qWeak2 = qb().oneOf(g, 'a', 11).build();
        // Replace binding by removing and re-adding with same id but different score
        ev.removeBinding('W');
        ev.addBinding({ id: 'W', query: qWeak2, tap: weaker, baseScore: 0 });

        res = ev.onGripsChanged(new Set([g]), ctxWith([[g, 'a']]));
        expect(res.get(out)?.bindingId).toBe('W');
    });
});


