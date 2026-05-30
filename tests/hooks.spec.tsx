import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  GripRegistry,
  GripOf,
  Grok,
  createAtomValueTap,
  AtomTap,
  AtomValueTap,
  MatchingContext,
  Tap,
} from '@owebeeone/grip-core';
import {
  GripProvider,
  useGrip,
  useAtomValueTap,
  useKeyedChildContext,
  useKeyedMatchingContext,
  useTap,
} from '../src';

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
    const grok = new Grok(registry);

    const tap = createAtomValueTap(VALUE, { initial: 1 }) as unknown as Tap;
    grok.registerTap(tap);

    const { result, rerender } = renderHook(() => useGrip(VALUE), { wrapper: wrapperWith(grok) });
    expect(result.current).toBe(1);

    (tap as any).set(2);
    rerender();
    expect(result.current).toBe(2);
  });

  it('useAtomValueTap registers/unregisters tap with lifecycle and exposes value via useGrip', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<number>('Hooks.Simple', 10);
    const VALUE_TAP = defineGrip<AtomTap<number>>('Hooks.Simple2.Tap', undefined);
    const grok = new Grok(registry);

    const { result, unmount, rerender } = renderHook(
      () => {
        useAtomValueTap(VALUE, { tapGrip: VALUE_TAP, initial: 5 });
        return { value: useGrip(VALUE), tap: useGrip(VALUE_TAP) };
      },
      { wrapper: wrapperWith(grok) }
    );

    expect(result.current.value).toBe(5);
    const tap = result.current.tap as AtomValueTap<number>;

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
    const grok = new Grok(registry);

    const factory = () => createAtomValueTap(VALUE, { initial: 'A' }) as unknown as Tap;

    const { result, unmount, rerender } = renderHook(
      () => {
        useTap(factory);
        return useGrip(VALUE);
      },
      { wrapper: wrapperWith(grok) }
    );

    expect(result.current).toBe('A');

    const node = grok.mainHomeContext._getContextNode();
    const rec = Array.from(node.producerByTap.values())[0];
    const tapInstance = (rec as any).tap as any;
    tapInstance.set('B');
    rerender();
    expect(result.current).toBe('B');

    unmount();
    const { result: after } = renderHook(() => useGrip(VALUE), { wrapper: wrapperWith(grok) });
    expect(after.current).toBe('init');
  });

  it('useAtomValueTap and useTap accept context-like containers', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const ATOM_VALUE = defineGrip<string>('Hooks.ContextLike.Atom', 'atom-default');
    const TAP_VALUE = defineGrip<string>('Hooks.ContextLike.Tap', 'tap-default');
    const grok = new Grok(registry);
    const matching = grok.mainPresentationContext.getOrCreateMatchingContext('react:context-like');

    const { result, rerender } = renderHook(
      () => {
        useAtomValueTap(ATOM_VALUE, { ctx: matching, initial: 'atom-live' });
        useTap(() => createAtomValueTap(TAP_VALUE, { initial: 'tap-live' }) as unknown as Tap, {
          ctx: matching,
        });
        return {
          atomValue: useGrip(ATOM_VALUE, matching),
          tapValue: useGrip(TAP_VALUE, matching),
        };
      },
      { wrapper: wrapperWith(grok) }
    );

    rerender();
    expect(result.current.atomValue).toBe('atom-live');
    expect(result.current.tapValue).toBe('tap-live');
  });

  it('keyed context hooks reuse contexts for stable keys', () => {
    const registry = new GripRegistry();
    const grok = new Grok(registry);

    const { result, rerender } = renderHook(
      () => ({
        child: useKeyedChildContext('weather:A'),
        matching: useKeyedMatchingContext('coin:A'),
      }),
      { wrapper: wrapperWith(grok) }
    );

    const firstChild = result.current.child;
    const firstMatching = result.current.matching;
    rerender();

    expect(result.current.child).toBe(firstChild);
    expect(result.current.matching).toBe(firstMatching);
    expect(result.current.matching).toBeInstanceOf(MatchingContext);
  });
});
