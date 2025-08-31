### GRIP Design Goals

A concise statement of the principles guiding GRIP’s engine and React-facing API.

### Primary Goal

- **Maximize decoupling**: UI depends only on typed data keys (Grips), never on data sources. Components are source-agnostic and express reads/writes without knowing where data comes from.

### Core Concepts

- **Grip<T>**: A typed key naming a value channel. The UI reads with `useGrip(grip, ctx?)`.
- **Drip<T>**: A live value stream for a `(grip, destCtx)` pair. Subscribable and GC-friendly.
- **Tap**: A producer that provides one or more grips (source, transform, controller).
- **Context DAG**: Hierarchical graph of `GripContext`s. Resolver picks the closest provider (tap) for a requested `(destCtx, grip)`.
- **Parameter Grips**:
  - **Destination params**: Read from the destination lineage; invalidate only that destination.
  - **Home params**: Read from the provider’s home lineage; invalidate all destinations under that provider.
- **Dual-context transforms**: Read at `home`, emit to `dest` (child) for clean transform semantics.

### React API Objectives

- **Ergonomic reads**: `useGrip(grip, ctx?)` returns strongly-typed values; re-renders on updates.
- **Minimal boilerplate contexts**:
  - `useChildContext(parent?)`: memoized child context (recreated when parent changes).
  - `useLocalContext(parent?)`: child context created once for component lifetime.
- **Composable tap registration**:
  - `useTap(() => tap, { ctx, deps })`: register/unregister lifecycle.
  - `useAtomValueTap(grip, { ctx, initial?, tapGrip? })`: one-liner for simple value sources.
- **Source-agnostic UI**: Components only reference grips and optional controllers; taps can switch between local compute, remote fetch, or transforms without UI changes.

### Invalidation & Lifecycle

- **Scoped invalidation**: Destination vs home parameters determine whether a single destination or all destinations under a provider are invalidated.
- **GC-aware**: WeakRefs for drips/contexts; engine cleans up unreachable graph nodes.
- **Task scheduling**: Auto-flush via microtasks to minimize latency and avoid event-loop churn.

### Performance

- **Stable identities**: Prefer stable contexts (`useLocalContext`) and controlled deps to avoid unnecessary work.
- **Efficient notifications**: Per-destination drip updates; only subscribed grips notify.
- **Async error surfacing**: Errors raised during task execution are reported asynchronously without breaking flush loops.

### Testability

- **Deterministic resolution**: Closest-provider semantics are explicit; unit tests can assert provider selection.
- **Pluggable taps**: Swap taps in tests to simulate sources, latency, or failure.
- **Pure UI**: Hooks and components are simple to test since they depend only on grips/contexts.

### Async, Loading, and Errors

- **Explicit modeling**: Represent async grips as `{ status, data, error }` or similar. Keep UI decoupled while still renderable across states.
- **Controllers for writes**: Expose intentful setters (e.g., `AtomTap.set`) rather than leaking transport details.

### Extensibility

- **Transforms**: Encourage taps that derive values from other grips (unit conversion, projections).
- **Multi-output taps**: Single tap may provide multiple grips; future-proofed for feeders/fan-out.
- **Ecosystem-ready**: Additional transports (REST, GraphQL, streaming) live behind taps; UI remains unchanged.

### Non-Goals

- **No business logic in components**: Computation belongs in taps, not UI.
- **No implicit global mutation**: Writes go through explicit controllers; avoid hidden side effects.

### Usage Sketches

- **Reading values**

```ts
const value = useGrip(MY_GRIP, ctx);
```

- **Local context per component**

```ts
const ctx = useLocalContext();
```

- **Register a simple value tap**

```ts
useAtomValueTap(MY_VALUE_GRIP, { ctx, initial: 42, tapGrip: MY_CONTROLLER_GRIP });
```

- **Generic select bound to grips**

```tsx
<GripSelect
  ctx={ctx}
  optionsGrip={OPTIONS_GRIP}
  valueGrip={VALUE_GRIP}
  controllerGrip={CONTROLLER_GRIP}
/>
```

### Related Docs

- See `GRIP_CONTEXT.md` for parameter topologies, dual-contexts, and resolver semantics.


