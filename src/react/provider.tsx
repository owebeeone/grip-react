import React, { createContext, useContext, useMemo } from "react";
import { Grok } from "../core/grok";
import { GripContext as GCtx } from "../core/context";
import { Grip } from "../core/grip";

type Runtime = { grok: Grok; context: GCtx };

const GripReactCtx = createContext<Runtime | null>(null);

export function GripProvider(props: { grok: Grok; context?: GCtx; children: React.ReactNode }) {
  const defaultCtx = props.context ?? props.grok.mainContext;
  const value = useMemo<Runtime>(() => ({ grok: props.grok, context: defaultCtx }), [props.grok, defaultCtx]);
  return <GripReactCtx.Provider value={value}>{props.children}</GripReactCtx.Provider>;
}

export function useRuntime(): Runtime {
  const rt = useContext(GripReactCtx);
  if (!rt) throw new Error("GripProvider missing");
  return rt;
}

// Create a child context off either an explicit parent or the provider's context
export function useChildContext(parent?: GCtx): GCtx {
  const { context: parentCtx } = useRuntime();
  return useMemo(() => (parent ?? parentCtx).createChild(), [parent, parentCtx]);
}
