/**
 * GRIP React Provider - Context provider for React integration
 * 
 * Provides React context integration for the GRIP system, enabling
 * components to access GROK engines and contexts throughout the
 * component tree. This is the foundation for all GRIP React hooks.
 * 
 * Key Features:
 * - GROK engine access throughout component tree
 * - Context hierarchy management
 * - Child context creation utilities
 * - Memoized context management
 * 
 * Use Cases:
 * - Providing GROK engine to React components
 * - Managing context hierarchies in React
 * - Enabling GRIP hooks throughout the app
 * - Context isolation and composition
 */

import React, { createContext, useContext, useMemo } from "react";
import { Grok, type GripContext as GCtx, type GripContextLike } from "@owebeeone/grip-core";

/**
 * Runtime configuration containing GROK engine and context.
 * 
 * Provides access to both the GROK engine and the current context
 * for React components that need to interact with the GRIP system.
 */
type Runtime = { grok: Grok; context: GripContextLike };

/**
 * React context for providing GRIP runtime to components.
 * 
 * This context makes the GROK engine and current context available
 * to all child components in the React tree.
 */
const GripReactCtx = createContext<Runtime | null>(null);

/**
 * Provider component that makes GRIP runtime available to child components.
 * 
 * The GripProvider wraps the React component tree and provides access
 * to a GROK engine and context. All GRIP hooks require this provider
 * to be present in the component tree.
 * 
 * @param props - Provider configuration
 * @param props.grok - The GROK engine to provide
 * @param props.context - Optional context to use (defaults to grok.mainContext)
 * @param props.children - React children to render
 */
export function GripProvider(props: {
  grok: Grok;
  context?: GripContextLike;
  children: React.ReactNode;
}) {
  const defaultCtx = props.context ?? props.grok.mainContext;
  const value = useMemo<Runtime>(() => ({ grok: props.grok, context: defaultCtx }), [props.grok, defaultCtx]);
  return <GripReactCtx.Provider value={value}>{props.children}</GripReactCtx.Provider>;
}

/**
 * Hook to access the GRIP runtime from React components.
 * 
 * Returns the GROK engine and current context. This hook must be used
 * within a GripProvider component tree.
 * 
 * @returns The GRIP runtime containing grok and context
 * @throws Error if GripProvider is missing from the component tree
 */
export function useRuntime(): Runtime {
  const rt = useContext(GripReactCtx);
  if (!rt) throw new Error("GripProvider missing");
  return rt;
}

/**
 * Returns a deterministic named child context from either an explicit parent
 * or the provider's context.
 * 
 * Named child contexts are required for persistence-friendly graph structure.
 * 
 * @param name - Deterministic child context name scoped to the parent context
 * @param parent - Optional parent context (defaults to provider's context)
 * @returns The named child context
 */
export function useChildContext(name: string, parent?: GCtx): GCtx {
  const { context: parentCtx } = useRuntime();
  return useMemo(
    () => (parent ?? parentCtx).getGripConsumerContext().getOrCreateChild(name),
    [name, parent, parentCtx],
  );
}

/**
 * Creates a memoized child context that never changes.
 * 
 * Similar to useChildContext, but the resolved named child context is memoized
 * for the component lifetime.
 * 
 * @param name - Deterministic child context name scoped to the parent context
 * @param parent - Optional parent context (defaults to provider's context)
 * @returns A stable named child context
 */
export function useLocalContext(name: string, parent?: GripContextLike): GCtx {
  const { context: providerCtx } = useRuntime();
  const ref = React.useRef<GCtx | null>(null);
  if (ref.current === null) {
    ref.current = (parent ?? providerCtx).getGripConsumerContext().getOrCreateChild(name);
  }
  return ref.current!;
}

export const useNamedChildContext = useChildContext;
export const useNamedLocalContext = useLocalContext;
