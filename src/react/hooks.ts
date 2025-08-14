import { useSyncExternalStore, useMemo } from "react";
import { Grip } from "../core/grip";
import { GripContext } from "../core/context";
import type { GripContextLike } from "../core/containers";
import { useRuntime } from "./provider";

// useGrip(grip, [ctx]) -> value (reactive)
export function useGrip<T>(grip: Grip<T>, ctx?: GripContext | GripContextLike): T {
  const { grok, context: providerCtx } = useRuntime();
  const activeCtx = (ctx && (ctx as any).getGripConsumerContext) ? (ctx as GripContextLike).getGripConsumerContext() : (ctx as GripContext | undefined) ?? providerCtx;

  // Get (and memoize) the Drip for this grip+ctx
  const drip = useMemo(() => grok.query(grip, activeCtx), [grok, activeCtx, grip]);

  // Subscribe via useSyncExternalStore
  const get = () => drip.get();
  return useSyncExternalStore((fn) => drip.subscribe(() => fn()), get, get);
}
