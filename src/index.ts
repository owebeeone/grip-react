/**
 * GRIP React Library - Generalized Retrieval Intent Provisioning
 *
 * A reactive dataflow library that provides declarative data management for React applications.
 * Components request data by Grip keys rather than directly managing data sources, enabling
 * automatic resolution of the best provider based on context hierarchy.
 *
 * Core Concepts:
 * - Grips: Typed keys for data attributes
 * - Contexts: Hierarchical containers for parameters and scope
 * - Taps: Data producers that provide Grips
 * - Drips: Live value streams for consuming data
 * - GROK: The central orchestrator managing the data flow graph
 */

// Core GRIP types and interfaces
export * from "./core/grip";
export * from "./core/context";
export * from "./core/drip";
export * from "./core/tap";
export * from "./core/grok";
export * from "./core/containers";

// Atom-based value taps for simple state management
export {
  AtomTapHandle as AtomTapHandle,
  AtomTap as AtomTap,
  AtomValueTap as AtomValueTap,
  createAtomValueTap as createAtomValueTap,
  MultiAtomTapHandle as MultiAtomTapHandle,
  MultiAtomTap as MultiAtomTap,
  MultiAtomValueTap as MultiAtomValueTap,
  createMultiAtomValueTap as createMultiAtomValueTap,
} from "./core/atom_tap";

// Base tap classes for building custom taps
export { BaseTap, BaseTapNoParams } from "./core/base_tap";

// React components for visualization and debugging
export { GripGraphVisualizer } from "./react/graph_visual";
export { GraphDumpDialog } from "./react/GraphDumpDialog";
export { GraphDumpButton } from "./react/GraphDumpButton";

// Graph inspection and debugging utilities
export { GripGraphDumper, GraphDumpKeyRegistry } from "./core/graph_dump";

// Caching and utility functions
export { LruTtlCache } from "./core/async_cache";
export { createDebouncer } from "./core/debounce";

// Async tap implementations for remote data and complex operations
export {
  BaseAsyncTap,
  createAsyncValueTap,
  createAsyncMultiTap,
  createAsyncHomeValueTap,
  createAsyncHomeMultiTap,
} from "./core/async_tap";

// React integration
export * from "./react/provider";
export * from "./react/hooks";

// Query system for declarative tap selection
export { withOneOf, withAnyOf, Query, QueryBuilderFactory } from "./core/query";
export { FunctionTap, createFunctionTap } from "./core/function_tap";

// Common grips
export { getLoggingTagsGrip } from "./logging";
