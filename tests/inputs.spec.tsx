import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  GripOf,
  GripRegistry,
  Grok,
  createAtomValueTap,
  type AtomValueTap,
  type Tap,
} from '@owebeeone/grip-core';
import {
  GripInput,
  GripProvider,
  GripTextarea,
  type AtomTapHandle,
} from '../src';

afterEach(() => cleanup());

function wrapperWith(grok: Grok) {
  return ({ children }: { children: React.ReactNode }) => (
    <GripProvider grok={grok}>{children}</GripProvider>
  );
}

describe('buffered grip text inputs', () => {
  it('keeps local input text while focused even when the grip updates', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<string>('Inputs.Value', '');
    const VALUE_TAP = defineGrip<AtomTapHandle<string>>('Inputs.Value.Tap');
    const grok = new Grok(registry);
    const tap = createAtomValueTap(VALUE, { initial: 'server', handleGrip: VALUE_TAP });
    grok.registerTap(tap as unknown as Tap);

    const { getByTestId } = render(
      <GripInput grip={VALUE} tapGrip={VALUE_TAP} data-testid="field" />,
      { wrapper: wrapperWith(grok) },
    );

    const input = getByTestId('field') as HTMLInputElement;
    expect(input.value).toBe('server');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'local draft' } });
    expect(input.value).toBe('local draft');
    expect(tap.get()).toBe('local draft');

    act(() => tap.set('remote update'));
    expect(input.value).toBe('local draft');

    fireEvent.blur(input);
    expect(tap.get()).toBe('local draft');
    expect(input.value).toBe('local draft');
  });

  it('can defer publishing textarea text until blur', () => {
    const registry = new GripRegistry();
    const defineGrip = GripOf(registry);
    const VALUE = defineGrip<string>('Inputs.Textarea', '');
    const VALUE_TAP = defineGrip<AtomTapHandle<string>>('Inputs.Textarea.Tap');
    const grok = new Grok(registry);
    const tap = createAtomValueTap(VALUE, { initial: 'old', handleGrip: VALUE_TAP }) as AtomValueTap<string>;
    grok.registerTap(tap as unknown as Tap);

    const { getByTestId } = render(
      <GripTextarea grip={VALUE} tapGrip={VALUE_TAP} update="blur" data-testid="field" />,
      { wrapper: wrapperWith(grok) },
    );

    const textarea = getByTestId('field') as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    fireEvent.change(textarea, { target: { value: 'draft only' } });

    expect(textarea.value).toBe('draft only');
    expect(tap.get()).toBe('old');

    act(() => tap.set('remote update'));
    expect(textarea.value).toBe('draft only');

    fireEvent.blur(textarea);
    expect(tap.get()).toBe('draft only');
  });
});
