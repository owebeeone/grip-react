import { useSyncExternalStore } from 'react';

export type GripStore<T> = {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createStore<T>(initial: T): GripStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(l => l());

  return {
    get: () => state,
    set: (next) => {
      state = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      notify();
    },
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn))
  };
}

/** React hook with optional selector */
export function useGrip<T, S = T>(
  store: GripStore<T>,
  selector?: (s: T) => S
): S {
  const getSnapshot = () => (selector ? selector(store.get()) : (store.get() as unknown as S));
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
