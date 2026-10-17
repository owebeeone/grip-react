import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Grok, GripOf, GripRegistry, createAtomValueTap } from '@owebeeone/grip-core';
import { GripGraphVisualizer } from '../src/react/graph_visual';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function fixture() {
  const registry = new GripRegistry();
  const VALUE = GripOf(registry)<string>('Graph.Value', '');
  const grok = new Grok(registry);
  grok.registerTap(createAtomValueTap(VALUE, { initial: 'visible value' }));
  grok.query(VALUE, grok.mainPresentationContext).subscribe(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600, height: 400, left: 0, top: 0, right: 600, bottom: 400, x: 0, y: 0, toJSON: () => ({}),
  });
  return grok;
}

describe('graph inspector', () => {
  it('can arrange context levels from left to right', () => {
    const view = render(<GripGraphVisualizer grok={fixture()} pause direction="horizontal" />);
    const root = view.getByRole('group', { name: 'Context root' });
    const home = view.getByRole('group', { name: 'Context main-home' });
    expect(Number.parseFloat(home.style.left)).toBeGreaterThan(Number.parseFloat(root.style.left));
    expect(home.style.top).toBe(root.style.top);
  });
  it('fits the complete canvas without shrinking card geometry alone', () => {
    const view = render(<GripGraphVisualizer grok={fixture()} pause fitToPane />);
    const canvas = view.getByTestId('graph-transform');
    expect(canvas.style.transform).toMatch(/^scale\(0\./);
    const node = view.getByRole('group', { name: 'Context main-home' });
    expect(node.style.width).toBe('280px');
  });

  it('respects the provider-link option', () => {
    const grok = fixture();
    const view = render(<GripGraphVisualizer grok={grok} pause />);
    expect(view.container.querySelectorAll('[data-edge-kind="provider"]').length).toBeGreaterThan(0);
    view.rerender(<GripGraphVisualizer grok={grok} pause showResolvedProviders={false} />);
    expect(view.container.querySelectorAll('[data-edge-kind="provider"]')).toHaveLength(0);
  });
});
