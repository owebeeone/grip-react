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

// Re-export everything from grip-core
export * from "@owebeeone/grip-core";

// React components for visualization and debugging
export { GripGraphVisualizer } from "./react/graph_visual";
export { GraphDumpDialog } from "./react/GraphDumpDialog";
export { GraphDumpButton } from "./react/GraphDumpButton";

// React integration
export * from "./react/provider";
export * from "./react/hooks";
