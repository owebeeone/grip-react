import { describe, it, expect } from 'vitest';
import { Drip } from '../src/core/drip';
import { GripRegistry, GripOf } from '../src/core/grip';
import { Grok } from '../src/core/grok';
import { GripContext } from '../src/core/context';
import type { Tap } from '../src/core/tap';

// Engine-level behavior test plan (TDD skeleton)

describe('Engine shared drip semantics', () => {
  it('returns the same drip instance for repeated queries of same (ctx, grip, tap)', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<number>('Value', 0);
    const grok = new Grok();
    const ctx = new GripContext('tctx');
    const tap: Tap = {
      id: 'const',
      provides: [VALUE],
      produce: () => new Drip<number>(42) as unknown as Drip<any>,
    };
    grok.registerTap(tap);
    const d1 = grok.query(VALUE, ctx);
    const d2 = grok.query(VALUE, ctx);
    expect(d1).toBe(d2);
    expect(d1.get()).toBe(42);
  });

  it('drip supports multiple subscribers and onFirst/onZero fire appropriately', () => {
    const d = new Drip<number>(1);
    let first = 0;
    let zero = 0;
    d.onFirstSubscriber(() => { first += 1; });
    d.onZeroSubscribers(() => { zero += 1; });
    const seen: number[] = [];
    const u1 = d.subscribe(v => seen.push(v));
    expect(first).toBe(1);
    const u2 = d.subscribe(v => seen.push(v * 10));
    d.next(2);
    expect(seen).toEqual([2, 20]);
    u1();
    u2();
    // zero-subscribers is notified when last unsubscribes
    expect(zero).toBe(1);
  });
});

describe('Engine parameter-driven updates', () => {
  it('changing a destination parameter grip invalidates cached mapping (new drip on re-query)', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const PARAM = defineGrip<string>('Param', 'A');
    const OUT = defineGrip<number>('Out', 0);
    const grok = new Grok();
    const ctx = new GripContext('pctx');
    // Tap depends on PARAM
    const tap: Tap = {
      id: 'paramTap',
      provides: [OUT],
      parameterGrips: [PARAM],
      produce: (_g, c) => {
        const ov = c.resolveOverride(PARAM);
        const p = ov?.type === 'value' ? (ov.value as string) : 'A';
        return new Drip<number>(p === 'A' ? 1 : 2) as unknown as Drip<any>;
      },
    };
    grok.registerTap(tap);
    // Initial
    ctx.setValue(PARAM, 'A');
    const d1 = grok.query(OUT, ctx);
    expect(d1.get()).toBe(1);
    // Change param; next query should yield a new drip reflecting new param
    ctx.setValue(PARAM, 'B');
    const d2 = grok.query(OUT, ctx);
    expect(d2).not.toBe(d1);
    expect(d2.get()).toBe(2);
  });
});

describe('Engine add/remove live taps', () => {
  it.todo('registering at ancestor connects descendants where applicable');
  it.todo('unregistering disconnects and re-resolves to next provider');
});


