import React, { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import {
  GripProvider, GripScope, useGrip,
  Grok, GripOf, GripRegistry, createAtomValueTap,
  type AtomTapHandle, type MatchingContext,
} from '../src';

afterEach(cleanup);

function fixture() {
  const registry = new GripRegistry();
  const define = GripOf(registry);
  const CITY = define<string>('Scope.City', 'unset');
  const HANDLE = define<AtomTapHandle<string>>('Scope.City.Handle');
  const grok = new Grok(registry);
  const seed = (ctx: MatchingContext, city = 'Sydney') => {
    const tap = createAtomValueTap(CITY, { initial: city, handleGrip: HANDLE });
    ctx.getGripHomeContext().registerTap(tap);
    return tap;
  };
  function Column() {
    const city = useGrip(CITY);
    const handle = useGrip(HANDLE);
    return <><output>{city}</output><button onClick={() => handle?.set('Paris')}>Paris</button></>;
  }
  return { CITY, HANDLE, grok, seed, Column };
}

describe('GripScope', () => {
  it('initializes before children read, with independent data and mutators per column', () => {
    const { grok, seed, Column } = fixture();
    const view = render(<GripProvider grok={grok}>
      <section data-testid="left"><GripScope scopeKey="column-1" init={ctx => seed(ctx)}><Column /></GripScope></section>
      <section data-testid="right"><GripScope scopeKey="column-2" init={ctx => seed(ctx, 'Melbourne')}><Column /></GripScope></section>
    </GripProvider>);
    const left = within(view.getByTestId('left'));
    const right = within(view.getByTestId('right'));
    expect(left.getByRole('status').textContent).toBe('Sydney');
    expect(right.getByRole('status').textContent).toBe('Melbourne');
    act(() => { fireEvent.click(left.getByRole('button')); grok.flush(); });
    expect(left.getByRole('status').textContent).toBe('Paris');
    expect(right.getByRole('status').textContent).toBe('Melbourne');
  });

  it('does not rerun an inline initializer or reset changed data on rerender', () => {
    const { grok, seed, Column } = fixture();
    const initialized = vi.fn();
    const contexts: MatchingContext[] = [];
    const tree = (initial: string) => <GripProvider grok={grok}>
      <GripScope scopeKey="column-1" init={ctx => { contexts.push(ctx); initialized(); seed(ctx, initial); }}>
        <Column />
      </GripScope>
    </GripProvider>;
    const view = render(tree('Sydney'));
    act(() => { fireEvent.click(view.getByRole('button')); grok.flush(); });
    view.rerender(tree('Darwin'));
    expect(view.getByRole('status').textContent).toBe('Paris');
    expect(initialized).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(1);
  });

  it('initializes a live keyed context once under Strict Mode', () => {
    const { grok, seed, Column } = fixture();
    const init = vi.fn((ctx: MatchingContext) => { seed(ctx); });
    const view = render(<StrictMode><GripProvider grok={grok}>
      <GripScope scopeKey="column-1" init={init}><Column /></GripScope>
    </GripProvider></StrictMode>);
    expect(view.getByRole('status').textContent).toBe('Sydney');
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('inherits its enclosing scope when no local override is supplied', () => {
    const { grok, seed, Column } = fixture();
    const view = render(<GripProvider grok={grok}>
      <GripScope scopeKey="outer" init={ctx => seed(ctx, 'Adelaide')}>
        <GripScope scopeKey="inner"><Column /></GripScope>
      </GripScope>
    </GripProvider>);
    expect(view.getByRole('status').textContent).toBe('Adelaide');
  });

  it('uses the nearest provider parent and keeps equal keys independent under different parents', () => {
    const { grok, seed, Column } = fixture();
    const parentA = grok.mainContext.getGripConsumerContext().createChild();
    const parentB = grok.mainContext.getGripConsumerContext().createChild();
    const contexts: MatchingContext[] = [];
    const tree = (parent: typeof parentA, city: string) => <GripProvider grok={grok} context={parent}>
      <GripScope scopeKey="same-column-key" init={ctx => { contexts.push(ctx); seed(ctx, city); }}><Column /></GripScope>
    </GripProvider>;
    const view = render(tree(parentA, 'Sydney'));
    view.rerender(tree(parentB, 'Darwin'));
    expect(view.getByRole('status').textContent).toBe('Darwin');
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).not.toBe(contexts[1]);
    view.rerender(tree(parentA, 'ignored'));
    expect(view.getByRole('status').textContent).toBe('Sydney');
    expect(contexts).toHaveLength(2);
  });

  it('selects a different context when its scope key changes', () => {
    const { grok, seed, Column } = fixture();
    const contexts: MatchingContext[] = [];
    const tree = (key: string, city: string) => <GripProvider grok={grok}>
      <GripScope scopeKey={key} init={ctx => { contexts.push(ctx); seed(ctx, city); }}><Column /></GripScope>
    </GripProvider>;
    const view = render(tree('column-1', 'Sydney'));
    view.rerender(tree('column-2', 'Melbourne'));
    expect(view.getByRole('status').textContent).toBe('Melbourne');
    expect(contexts[0]).not.toBe(contexts[1]);
    view.rerender(tree('column-1', 'ignored'));
    expect(view.getByRole('status').textContent).toBe('Sydney');
    expect(contexts).toHaveLength(2);
  });

  it('does not retire a context or taps owned by an external container on unmount', () => {
    const { CITY, grok, seed, Column } = fixture();
    let tap: ReturnType<typeof seed>;
    const owned = grok.mainContext.getGripConsumerContext().getOrCreateMatchingContext('owned', ctx => { tap = seed(ctx); });
    const detached = vi.spyOn(tap!, 'onDetach');
    const init = vi.fn();
    const view = render(<GripProvider grok={grok}><GripScope scopeKey="owned" init={init}><Column /></GripScope></GripProvider>);
    view.unmount();
    expect(init).not.toHaveBeenCalled();
    expect(detached).not.toHaveBeenCalled();
    expect(grok.query(CITY, owned).get()).toBe('Sydney');
  });

  it('reports a missing parent provider', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { expect(() => render(<GripScope scopeKey="orphan"><span /></GripScope>)).toThrow('GripProvider missing'); }
    finally { errors.mockRestore(); }
  });

  it('propagates initializer failures instead of rendering a partly initialized subtree', () => {
    const { grok } = fixture();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<GripProvider grok={grok}>
        <GripScope scopeKey="broken" init={() => { throw new Error('seed failed'); }}><span>must not render</span></GripScope>
      </GripProvider>)).toThrow('seed failed');
    } finally { errors.mockRestore(); }
  });
});
