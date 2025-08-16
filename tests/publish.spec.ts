import { describe, it, expect } from 'vitest';
import { Grok } from '../src/core/grok';
import { GripRegistry, GripOf } from '../src/core/grip';
import { Drip } from '../src/core/drip';
import { createSimpleValueTap, SimpleTap, SimpleValueTap } from '../src/core/simple_tap';
import type { Tap } from '../src/core/tap';

describe('Engine publish()', () => {
  it('updates all destinations under the same home for a single grip', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const OUT = defineGrip<number>('Pub.Out', 0);
    const grok = new Grok();
    const home = grok.mainContext;
    const A = home.createChild();
    const B = home.createChild();

    const tap = createSimpleValueTap(OUT, { initial: 1 });
    grok.registerTapAt(home, tap as unknown as Tap);

    // connect
    expect(grok.query(OUT, A).get()).toBe(1);
    expect(grok.query(OUT, B).get()).toBe(1);

    // publish new value
    const updates = new Map([[OUT as any, 99]]);
    grok.publish(home, tap, updates);

    expect(grok.query(OUT, A).get()).toBe(99);
    expect(grok.query(OUT, B).get()).toBe(99);
  });

  it('does not affect destinations overshadowed by a closer provider', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const OUT = defineGrip<number>('Pub.Out2', 0);
    const grok = new Grok();
    const home = grok.mainContext;
    const A = home.createChild();
    const B = home.createChild();

    const ancestorTap = createSimpleValueTap(OUT, { initial: 10 });
    grok.registerTapAt(home, ancestorTap as unknown as Tap);
    expect(grok.query(OUT, A).get()).toBe(10);
    expect(grok.query(OUT, B).get()).toBe(10);

    const localTap = createSimpleValueTap(OUT, { initial: 7 });
    grok.registerTapAt(B, localTap as unknown as Tap);
    // B now uses local provider
    expect(grok.query(OUT, B).get()).toBe(7);

    const updates = new Map([[OUT as any, 42]]);
    grok.publish(home, ancestorTap as unknown as Tap, updates);

    expect(grok.query(OUT, A).get()).toBe(42);
    // B remains from local tap
    expect(grok.query(OUT, B).get()).toBe(7);
  });

  it('supports publishing multiple grips in one call', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const G1 = defineGrip<number>('Pub.G1', 1);
    const G2 = defineGrip<number>('Pub.G2', 2);
    const grok = new Grok();
    const home = grok.mainContext;
    const D = home.createChild();

    // TODO - use MultiSimpleTap
    const tap1 = createSimpleValueTap(G1, { initial: 1 });
    const tap2 = createSimpleValueTap(G2, { initial: 2 });
    grok.registerTapAt(home, tap1 as unknown as Tap);
    grok.registerTapAt(home, tap2 as unknown as Tap);
    expect(grok.query(G1, D).get()).toBe(1);
    expect(grok.query(G2, D).get()).toBe(2);

    const updates = new Map<unknown, unknown>([
      [G1 as any, 11],
      [G2 as any, 22],
    ]);
    (tap1 as any as Tap).produce();
    (tap2 as any as Tap).produce();

    expect(grok.query(G1, D).get()).toBe(11);
    expect(grok.query(G2, D).get()).toBe(22);
  });
});


