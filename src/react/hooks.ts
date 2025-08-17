import { useSyncExternalStore, useMemo, useEffect, useCallback } from "react";
import { Grip } from "../core/grip";
import { GripContext } from "../core/context";
import type { GripContextLike } from "../core/containers";
import { useRuntime } from "./provider";
import { Tap } from "../core/tap";
import { createSimpleValueTap, SimpleTapHandle } from "../core/simple_tap";

// useGrip(grip, [ctx]) -> value (reactive)
export function useGrip<T>(grip: Grip<T>, ctx?: GripContext | GripContextLike): T | undefined {
  const { grok, context: providerCtx } = useRuntime();
  const activeCtx = (ctx && (ctx as any).getGripConsumerContext) ? (ctx as GripContextLike).getGripConsumerContext() : (ctx as GripContext | undefined) ?? providerCtx;

  // Get (and memoize) the Drip for this grip+ctx
  const drip = useMemo(() => grok.query(grip, activeCtx), [grok, activeCtx, grip]);

  // Subscribe via useSyncExternalStore with memoized callbacks
  const get = useCallback(() => drip.get(), [drip]);
  const subscribe = useCallback((notify: () => void) => drip.subscribe(() => notify()), [drip]);
  return useSyncExternalStore(subscribe, get, get);
}

export function useSimpleValueTap<T>(
  grip: Grip<T>,
  opts?: { ctx?: GripContext; tapGrip?: Grip<SimpleTapHandle<T>>; initial?: T }
): void {
  const { context: providerCtx } = useRuntime();
  const ctx = opts?.ctx ?? providerCtx;

  // create the tap only when ctx changes (ignore subsequent initial changes)
  const tap: Tap = useMemo(
    () => createSimpleValueTap(grip, { initial: opts?.initial, handleGrip: opts?.tapGrip }) as unknown as Tap,
    [ctx, grip, opts?.tapGrip] // intentionally exclude opts?.initial
  );

  useEffect(() => {
    ctx.registerTap(tap);
    return () => { ctx.unregisterTap(tap); };
  }, [ctx, tap]);
}

export function useTap(
  factory: () => Tap,
  opts?: { ctx?: GripContext; deps?: React.DependencyList } // deps to control re-creation
): void {
  const { context: providerCtx } = useRuntime();
  const ctx = opts?.ctx ?? providerCtx;
  const tap = useMemo(factory, opts?.deps ?? [ctx]); // default: recreate only when ctx changes

  useEffect(() => {
    ctx.registerTap(tap);
    return () => { ctx.unregisterTap(tap); };
  }, [ctx, tap]);
}
