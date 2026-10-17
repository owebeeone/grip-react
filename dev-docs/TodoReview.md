# GRIP React TODO review

The previous TODO list mixed early engine design proposals with React work.
This review reconciles those entries with the current source and tests. The
active backlog is [TODOS.md](../TODOS.md); the documentation work is detailed
in [the README plan](ReadmePlan.md).

## Existing implementation and coverage

| Older entry | Current disposition |
| --- | --- |
| Track outputs per tap and context for exact unregister | Producer records track destinations and grips. Removal uses those records and only removes mappings owned by that producer. Retire the old cache-key-scan implementation prescription. |
| Add multi-parent and priority tests | Core resolver tests already exercise multiple parents and priorities. Additional cases need an identified coverage gap rather than a blanket request to implement the feature. |
| Update mappings after parent-link changes | Context changes notify the resolver; the audit added parent-change regressions. Retire this as an unimplemented feature. |
| Implement connection-based production and multi-output delivery | Connection hooks, destination records, and multi-output taps exist. Retire the old implementation plan; any alternative sink API needs a separate design and reason. |
| Manage parameter subscriptions | Core implements parameter subscription and cleanup, with audit regressions. Retain React lifecycle verification rather than describing the whole mechanism as missing. |
| Add an atom helper and migrate old setter names | Atom helpers and controller APIs exist. Retire the old naming proposal; use and document the actual exported APIs. |
| Reintroduce per-node indices | Nodes already maintain producer, resolved-provider, and consumer maps. Retire the general request to add indices; any optimization needs an observed workload and measurement. |
| Add an engine-aware context hook | Context construction already requires Grok and ensures a graph node; the current hooks create children through their parent. No extra hook is justified by the original registration rationale. |
| Add shared-drip, precedence, and parameter-invalidation tests | Core has coverage in engine, resolver, function-tap, publishing, and audit suites. React-specific transitions remain verification work in the active backlog. |
| Set package sideEffects to boolean false | Already correct in package.json. Remove from the active backlog. |

Implementation references are in the sibling core repository's
`src/core/context.ts`, `grok.ts`, `graph.ts`, `tap_resolver.ts`, and
`base_tap.ts`. Relevant core tests include `engine.spec.ts`,
`tap_resolver.spec.ts`, `function_tap.spec.ts`, `publish.spec.ts`, and
`audit_composition.spec.ts`. React initialization and registration are in
`src/react/provider.tsx` and `src/react/hooks.ts`.

## Core proposals requiring a separate decision or verification

These were not established defects and are not silently marked complete:

- **Constructor visibility.** Requiring Grok and registering a graph node
  addresses the original engine-registration concern. Whether direct context
  construction should also be restricted to enforce parent/factory policy is
  a separate core API decision.
- **Context-scoped unregistration.** The current API finds a tap's home and
  removes it there. A new `unregisterTapAt(ctx, tapId)` API needs a use case
  consistent with tap ownership; its absence alone is not a bug.
- **Garbage collection.** Weak-reference tracking and collection exist, but
  the older request to prove safe reclamation without interrupting live
  delivery remains a verification topic. It is not a finding from this TODO
  cleanup.
- **Resolver diagnostics.** Graph inspection and sanity-check APIs exist.
  Whether devtools need a distinct resolver-state or resolution-reason view
  needs concrete diagnostic requirements; the existing view does not by itself
  settle that proposal.
- **Resolver documentation.** Check shared documentation against actual
  behavior before updating it. Do not carry forward an old planned sink API
  as an implementation requirement without a new decision.

## Work retained in the React backlog

The ordinary child-context initializer is still an API question. Keyed child
and matching contexts already accept initialization callbacks, so the task is
to decide what additional behavior is needed and how it fits React lifetimes.

React has existing subscription, registration, unmount, keyed-context, and
input-binding tests. Strict Mode and context-transition verification remain
useful extensions; this review does not assert a failure in those cases.

Weather-demo lifecycle and cache notes require checking the current demo
source. The older parameter names and cache reference should not be treated
as a confirmed current defect. Tutorial, setup, and example improvements are
now covered by the README plan.

This cleanup changes documentation only. It does not add APIs, change runtime
behavior, or claim that every historical test idea has been exhaustively
verified.
