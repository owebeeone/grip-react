import React from 'react';
import type { MatchingContext } from '@owebeeone/grip-core';
import { useKeyedMatchingContext } from './hooks';
import { GripProvider, useRuntime } from './provider';

export interface GripScopeProps {
  /** Stable UI identity within the enclosing context, not a changing data value. */
  scopeKey: string;
  /** Synchronous initialization, called only when a new keyed context is created. */
  init?: (context: MatchingContext) => void;
  children: React.ReactNode;
}

/**
 * Provides a keyed matching context to a React subtree. Initial taps belong on
 * context.getGripHomeContext(); consumers inherit the presentation context.
 *
 * Existing live keys reuse their context even if the init callback changes.
 * A different key or enclosing context selects a different scope. Unmounting
 * does not retire an externally owned context: containers such as desktop tabs
 * retain their own lifetime policy. Unreferenced contexts follow core's GC.
 */
export function GripScope({ scopeKey, init, children }: GripScopeProps) {
  const { grok } = useRuntime();
  const context = useKeyedMatchingContext(scopeKey, { init });
  return <GripProvider grok={grok} context={context}>{children}</GripProvider>;
}
