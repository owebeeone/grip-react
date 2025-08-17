import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { GripRegistry, GripOf } from '../src/core/grip';
import { Grok } from '../src/core/grok';
import { GripProvider } from '../src/react/provider';
import { useGrip, useSimpleValueTap, useTap } from '../src/react/hooks';
import { createSimpleValueTap, SimpleTap, SimpleValueTap } from '../src/core/simple_tap';
import type { Tap } from '../src/core/tap';

function wrapperWith(grok: Grok) {
  return ({ children }: { children: React.ReactNode }) => (
    <GripProvider grok={grok}>{children}</GripProvider>
  );
}

describe('react hooks', () => {
  it('useGrip subscribes to updates and returns latest value', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<number>('Hooks.Value', 0);
    const grok = new Grok();

    const tap = createSimpleValueTap(VALUE, { initial: 1 }) as unknown as Tap;
    grok.registerTap(tap);

    const { result, rerender } = renderHook(() => useGrip(VALUE), { wrapper: wrapperWith(grok) });
    expect(result.current).toBe(1);

    (tap as any).set(2);
    rerender();
    expect(result.current).toBe(2);
  });

  it('useSimpleValueTap registers/unregisters tap with lifecycle and exposes value via useGrip', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<number>('Hooks.Simple', 10);
    const VALUE_TAP = defineGrip<SimpleValueTap<number>>('Hooks.Simple2.Tap', undefined);
    const grok = new Grok();

    const { result, unmount, rerender } = renderHook(
      () => {
        useSimpleValueTap(VALUE, { tapGrip: VALUE_TAP, initial: 5 });
        return {value: useGrip(VALUE), tap: useGrip(VALUE_TAP)};
      },
      { wrapper: wrapperWith(grok) }
    );

    expect(result.current.value).toBe(5);
    const tap = result.current.tap as SimpleValueTap<number>;

    // Find the tap and update its value
    tap.set(7);
    grok.flush();
    rerender();
    expect(result.current.value).toBe(7);

    unmount();
    const { result: after } = renderHook(() => useGrip(VALUE), { wrapper: wrapperWith(grok) });
    expect(after.current).toBe(10);
  });

  it('useTap registers arbitrary tap factory and cleans up on unmount', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<string>('Hooks.Custom', 'init');
    const grok = new Grok();

    const factory = () => createSimpleValueTap(VALUE, { initial: 'A' }) as unknown as Tap;

    const { result, unmount, rerender } = renderHook(
      () => {
        useTap(factory);
        return useGrip(VALUE);
      },
      { wrapper: wrapperWith(grok) }
    );

    expect(result.current).toBe('A');

    const node = grok.ensureNode(grok.mainContext);
    const rec = Array.from(node.producerByTap.values())[0];
    const tapInstance = (rec as any).tap as any;
    tapInstance.set('B');
    rerender();
    expect(result.current).toBe('B');

    unmount();
    const { result: after } = renderHook(() => useGrip(VALUE), { wrapper: wrapperWith(grok) });
    expect(after.current).toBe('init');
  });
});
