import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
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
  it('lists every registered producer and requested drip beyond six entries', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const grips = Array.from({ length: 10 }, (_, i) => defineGrip<number>(`Graph.Value${i}`));
    const grok = new Grok(registry);
    const unsubscribe = grips.map((grip, i) => {
      grok.registerTap(createAtomValueTap(grip, { initial: i }));
      return grok.query(grip, grok.mainPresentationContext).subscribe(() => {});
    });
    const view = render(<GripGraphVisualizer grok={grok} pause />);
    const consumers = within(view.getByRole('group', { name: 'Context main-presentation' }));
    const producers = within(view.getByRole('group', { name: 'Context main-home' }));
    try {
      for (const grip of grips) expect(consumers.getByText(grip.key, { exact: true })).toBeTruthy();
      expect(producers.getAllByText('AtomValueTap', { exact: true })).toHaveLength(10);
    } finally {
      view.unmount();
      unsubscribe.forEach(stop => stop());
    }
  });

  it('shows coordinates reconnected after the other weather drips', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const latitude = defineGrip<number>('Geo.Lat');
    const longitude = defineGrip<number>('Geo.Lng');
    const weather = Array.from({ length: 8 }, (_, i) => defineGrip<number>(`Weather.Value${i}`));
    const grok = new Grok(registry);
    const drips = [latitude, longitude, ...weather].map((grip, i) => {
      grok.registerTap(createAtomValueTap(grip, { initial: i }));
      return grok.query(grip, grok.mainPresentationContext);
    });
    const stops = drips.map(drip => drip.subscribe(() => {}));
    const view = render(<GripGraphVisualizer grok={grok} pause refreshTrigger={0} />);
    try {
      stops[0]();
      stops[1]();
      grok.flush();
      view.rerender(<GripGraphVisualizer grok={grok} pause refreshTrigger={1} />);
      const mock = within(view.getByRole('group', { name: 'Context main-presentation' }));
      expect(mock.queryByText(latitude.key, { exact: true })).toBeNull();
      expect(mock.queryByText(longitude.key, { exact: true })).toBeNull();

      stops[0] = drips[0].subscribe(() => {});
      stops[1] = drips[1].subscribe(() => {});
      grok.flush();
      view.rerender(<GripGraphVisualizer grok={grok} pause refreshTrigger={2} />);
      const live = within(view.getByRole('group', { name: 'Context main-presentation' }));
      expect(live.getByText(latitude.key, { exact: true })).toBeTruthy();
      expect(live.getByText(longitude.key, { exact: true })).toBeTruthy();
      for (const grip of weather) expect(live.getByText(grip.key, { exact: true })).toBeTruthy();
    } finally {
      view.unmount();
      stops.forEach(stop => stop());
    }
  });

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
