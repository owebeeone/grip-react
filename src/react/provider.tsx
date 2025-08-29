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
import { Grok } from "../core/grok";
import { GripContextLike as GCtx, GripContextLike } from "../core/context";
import { Grip } from "../core/grip";

/**
 * Runtime configuration containing GROK engine and context.
 * 
 * Provides access to both the GROK engine and the current context
 * for React components that need to interact with the GRIP system.
 */
type Runtime = { grok: Grok; context: GCtx };

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
export function GripProvider(props: { grok: Grok; context?: GCtx; children: React.ReactNode }) {
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
 * Creates a child context from either an explicit parent or the provider's context.
 * 
 * This hook creates a new child context that can be used for component-specific
 * data or parameter overrides. The child context is recreated whenever the parent
 * context changes.
 * 
 * @param parent - Optional parent context (defaults to provider's context)
 * @returns A new child context
 */
export function useChildContext(parent?: GCtx): GCtx {
  const { context: parentCtx } = useRuntime();
  return useMemo(() => (parent ?? parentCtx).getGripConsumerContext().createChild(), [parent, parentCtx]);
}

/**
 * Creates a memoized child context that never changes.
 * 
 * Similar to useChildContext, but the created context is memoized and
 * never changes during the component's lifetime. This is useful for
 * contexts that should remain stable across re-renders.
 * 
 * @param parent - Optional parent context (defaults to provider's context)
 * @returns A stable child context that never changes
 */
export function useLocalContext(parent?: GripContextLike): GripContextLike {
  const { context: providerCtx } = useRuntime();
  const ref = React.useRef<GripContextLike | null>(null);
  if (ref.current === null) {
    ref.current = (parent ?? providerCtx).getGripConsumerContext().createChild();
  }
  return ref.current;
}