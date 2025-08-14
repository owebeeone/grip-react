import { describe, it, expect } from 'vitest';
import { Grok } from '../src/core/grok';
import { GripRegistry, GripOf } from '../src/core/grip';
import { createSimpleValueTap } from '../src/core/simple_tap';
import type { SimpleTap } from '../src/core/simple_tap';

describe('SimpleTap', () => {
  it('controller set updates all destinations under the same home', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<string>('Value', 'init');
    const VALUE_TAP = defineGrip<SimpleTap<string>>('ValueTap', undefined as any);

    const grok = new Grok();
    const home = grok.mainContext;
    const destA = grok.createContext('A', home);
    const destB = grok.createContext('B', home);

    const { tap } = createSimpleValueTap(VALUE, { initial: 'A', handleGrip: VALUE_TAP });
    grok.registerTapAt(home, tap);

    // Connect destinations to provider by querying
    const vA1 = grok.query(VALUE, destA);
    const vB1 = grok.query(VALUE, destB);
    expect(vA1.get()).toBe('A');
    expect(vB1.get()).toBe('A');

    // Get controller at a destination and set
    const ctrl = (grok.query(VALUE_TAP, destA) as any).get() as SimpleTap<string>;
    ctrl.set('B');

    // Both destinations under the same home should reflect the update
    const vA2 = grok.query(VALUE, destA);
    const vB2 = grok.query(VALUE, destB);
    expect(vA2.get()).toBe('B');
    expect(vB2.get()).toBe('B');
  });

  it('controllers are scoped to their home (no cross-talk)', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<string>('Scoped.Value', 'init');
    const VALUE_TAP = defineGrip<SimpleTap<string>>('Scoped.ValueTap', undefined as any);

    const grok = new Grok();
    const homeRoot = grok.mainContext;
    const homeChild = grok.createContext('HomeChild', homeRoot);

    const { tap: tapRoot } = createSimpleValueTap(VALUE, { initial: 'R', handleGrip: VALUE_TAP });
    grok.registerTapAt(homeRoot, tapRoot);
    const { tap: tapChild } = createSimpleValueTap(VALUE, { initial: 'C', handleGrip: VALUE_TAP });
    grok.registerTapAt(homeChild, tapChild);

    const destR = grok.createContext('DestR', homeRoot);
    const destC = grok.createContext('DestC', homeChild);

    // Connect
    expect(grok.query(VALUE, destR).get()).toBe('R');
    expect(grok.query(VALUE, destC).get()).toBe('C');

    // Set via child controller
    const ctrlC = (grok.query(VALUE_TAP, destC) as any).get() as SimpleTap<string>;
    ctrlC.set('X');
    expect(grok.query(VALUE, destC).get()).toBe('X');
    // Root value remains
    expect(grok.query(VALUE, destR).get()).toBe('R');
  });
});


