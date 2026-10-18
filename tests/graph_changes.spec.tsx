import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Grok, GripRegistry, GripOf, createAtomValueTap } from '@owebeeone/grip-core';
import { GripGraphVisualizer } from '../src/react/graph_visual';

const originalAnimate = HTMLElement.prototype.animate;
afterEach(() => {
  cleanup();
  if (originalAnimate) {
    HTMLElement.prototype.animate = originalAnimate;
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
  vi.unstubAllGlobals();
});
function fixture() {
  const registry = new GripRegistry();
  const value = GripOf(registry)<number>('Graph.Change');
  const grok = new Grok(registry);
  const tap = createAtomValueTap(value, { initial: 1 });
  grok.registerTap(tap);
  const drip = grok.query(value, grok.mainPresentationContext);
  const stop = drip.subscribe(() => {});
  grok.flush();
  return { grok, tap, stop };
}
it.each([false, true])('highlights only changed values, preserving rows and honoring reduced motion=%s', reduced => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })));
  const cancels: ReturnType<typeof vi.fn>[] = [];
  const animate = vi.fn(function (this: HTMLElement) {
    const cancel = vi.fn();
    cancels.push(cancel);
    return { cancel } as unknown as Animation;
  });
  HTMLElement.prototype.animate = animate;
  const f = fixture();
  const view = render(<GripGraphVisualizer grok={f.grok} pause />);
  const row = view.container.querySelector('[title="app:Graph.Change"]');
  expect(row).not.toBeNull();
  expect(animate).not.toHaveBeenCalled();
  act(() => { f.tap.set(2); f.grok.flush(); });
  view.rerender(<GripGraphVisualizer grok={f.grok} pause refreshTrigger={1} />);
  expect(row).toBe(view.container.querySelector('[title="app:Graph.Change"]'));
  expect(row?.textContent).toContain('2');
  expect(animate).toHaveBeenCalledTimes(1);
  const active = { backgroundColor: "#0759c7", color: "#ffffff", boxShadow: "0 0 0 2px #003b8e, 0 0 0 4px #ffcf33" };
  const clear = { backgroundColor: "transparent", color: "#213547", boxShadow: "0 0 0 2px transparent, 0 0 0 4px transparent" };
  expect(animate).toHaveBeenLastCalledWith([
    { ...active, offset: 0, easing: "steps(1, end)" }, { ...active, ...(reduced ? {} : { backgroundColor: "#dbeafe", color: "#213547" }), offset: 0.3 }, { ...(reduced ? active : clear), offset: 1 },
  ], { duration: 1500, easing: "linear" });
  view.rerender(<GripGraphVisualizer grok={f.grok} pause refreshTrigger={2} />);
  expect(animate).toHaveBeenCalledTimes(1);
  expect(cancels[0]).not.toHaveBeenCalled();
  act(() => { f.tap.set(3); f.grok.flush(); });
  view.rerender(<GripGraphVisualizer grok={f.grok} pause refreshTrigger={3} />);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(cancels[0]).toHaveBeenCalledOnce();
  const replacement = fixture();
  view.rerender(<GripGraphVisualizer grok={replacement.grok} pause />);
  expect(animate).toHaveBeenCalledTimes(2);
  expect(cancels[1]).toHaveBeenCalledOnce();
  act(() => { replacement.tap.set(4); replacement.grok.flush(); });
  view.rerender(<GripGraphVisualizer grok={replacement.grok} pause refreshTrigger={1} />);
  expect(animate).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(cancels[2]).toHaveBeenCalledOnce();
  f.stop();
  replacement.stop();
});
