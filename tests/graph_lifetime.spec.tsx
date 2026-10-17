import React from 'react';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Grok, GripOf, GripRegistry, createAtomValueTap, type AtomTapHandle } from '@owebeeone/grip-core';
import { GripGraphVisualizer } from '../src/react/graph_visual';

setFlagsFromString('--expose_gc');
const collect = runInNewContext('gc') as () => void;
afterEach(cleanup);

describe('graph observer lifetime', () => {
  it.each([false, true])('does not retain an otherwise unused consumer context with viewer=%s', async shown => {
    const registry = new GripRegistry();
    const VALUE = GripOf(registry)<number>('Observer.Value', 42);
    const grok = new Grok(registry);
    const reference = (() => {
      const context = grok.createContext();
      grok.query(VALUE, context);
      if (shown) render(<GripGraphVisualizer grok={grok} pause />);
      return new WeakRef(context);
    })();
    for (let i = 0; i < 5; i++) {
      await setImmediate();
      collect();
    }
    expect(reference.deref() !== undefined).toBe(false);
  });
  it('does not retain a populated context through producer records or handle values', async () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<number>('Observer.AtomValue');
    const HANDLE = defineGrip<AtomTapHandle<number>>('Observer.AtomHandle');
    const grok = new Grok(registry);
    const reference = (() => {
      const context = grok.createContext();
      context.registerTap(createAtomValueTap(VALUE, { initial: 42, handleGrip: HANDLE }));
      const unsubscribe = grok.query(HANDLE, context).subscribe(() => {});
      render(<GripGraphVisualizer grok={grok} pause />);
      unsubscribe();
      grok.flush();
      return new WeakRef(context);
    })();
    for (let i = 0; i < 5; i++) { await setImmediate(); collect(); }
    expect(reference.deref() !== undefined).toBe(false);
  });
});
