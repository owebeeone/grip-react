import { useSyncExternalStore, useMemo } from "react";
import { Grip } from "../core/grip";
import { GripContext } from "../core/context";
import { useRuntime } from "./provider";

// useGrip(grip, [ctx]) -> value (reactive)
export function useGrip<T>(grip: Grip<T>, ctx?: GripContext): T {
  const { grok, context: providerCtx } = useRuntime();
  const activeCtx = ctx ?? providerCtx;

  // Get (and memoize) the Drip for this grip+ctx
  const drip = useMemo(() => grok.query(grip, activeCtx), [grok, activeCtx, grip]);

  // Subscribe via useSyncExternalStore
  const get = () => drip.get();
  return useSyncExternalStore((fn) => drip.subscribe(() => fn()), get, get);
}
