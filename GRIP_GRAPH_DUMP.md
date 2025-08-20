## Grip Graph Dump: Design Spec

Goal: Add a developer tool to the demo that opens a dialog showing a JSON dump of the current Grip graph (contexts, taps, drips) with stable, human-readable keys. Provide Copy and Dismiss actions. This feature must not mutate the graph or use Grip state (to avoid influencing the graph under inspection).

Scope for this spec
- No code changes in this edit. This is a design document for a small, modular addition.
- Two new pieces when implemented:
  - Core: a React-agnostic dumper that walks the graph, composes a JSON payload, and maintains stable keys via WeakMaps.
  - React: a plug-and-play dialog + button component that invokes the dumper and renders JSON with Copy and Dismiss controls.

Out-of-scope
- Changing existing core types or runtime behavior.
- Using Grip itself to hold UI state for the dialog (use React local state only).

---

### User Experience
- Extend the centered control group in the demo UI (the "Hide/Show Graph" + "Refresh Graph" buttons) with a new button: "Dump Graph".
- Clicking opens a modal dialog containing:
  - A timestamp (as part of the top level json object)
  - Pretty-printed JSON for the graph dump
  - Buttons: "Copy" (writes JSON to clipboard) and "Dismiss" (closes dialog)
- Subsequent clicks should produce identical keys for the same live objects (contexts, taps, drips) as long as they still exist. New objects get new keys.

Accessibility/UX
- Modal traps focus, ESC to close, and supports keyboard navigation.
- Large JSON is scrollable; Copy copies the exact JSON payload.

---

### Data Model and JSON Shape

High-level JSON payload shape:
```json
{
  "timestampIso": "2025-01-01T12:34:56.789Z",
  "summary": {
    "contextCount": 0,
    "tapCount": 0,
    "dripCount": 0
  },
  "nodes": {
    "contexts": [
      {
        "key": "kCtxt1",
        "type": "Context",
        "label": "root" ,
        "children": ["kCtxt2", "kCtxt3"],
        "taps": ["kTap1", "kTap2"],
        "metadata": {
          "isRoot": true
        }
      }
    ],
    "taps": [
      {
        "key": "kTap1",
        "type": "Tap",
        "class": "AtomValueTap",
        "providesGrips": ["Grip(WEATHER_LOCATION)", "Grip(WEATHER_LOCATION_TAP)"],
        "publisherContext": "kCtxt2",
        "drips": ["kDrip1"],
        "state": {
          "simpleValue": "San Jose"
        }
      }
    ],
    "drips": [
      {
        "key": "kDrip1",
        "type": "Drip",
        "grip": "Grip(WEATHER_TEMP_C)",
        "providerTap": "kTap1",
        "destContext": "kCtxt2",
        "valuePreview": 23
      }
    ]
  }
}
```

Notes
- Keys are stable within a dumper instance lifetime and are of the form `kCtxt1`, `kTap7`, `kDrip12`.
- `valuePreview` is optional and should truncate large values safely.
- `label` is best-effort (e.g., "root", or derived hints); avoid reading private internals unless publicly exposed.

Tap relationships
- Taps can have multiple relationship directions and should reflect them explicitly in JSON:
  - `incomingHomeParamDrips`: array of drip keys that feed the tap's "home" parameters
  - `incomingDestParamDrips`: array of drip keys that feed the tap's "destination" parameters
  - `outgoingDrips`: array of drip keys produced by this tap (alias of previous `drips`)
  - `destinationContexts`: array of context keys the tap publishes into (when applicable)
  - These fields are optional and included on a best-effort basis depending on what the runtime exposes

---

### Stable Keys via WeakMaps

Constraints
- Do not hold strong references that prevent GC. Use `WeakMap<object, string>` per node category:
  - `contextToKey: WeakMap<Context, string>`
  - `tapToKey: WeakMap<Tap, string>`
  - `dripToKey: WeakMap<Drip, string>`
- Maintain counters:
  - `contextSeq = 1`, `tapSeq = 1`, `dripSeq = 1`
- Key allocation:
  - If object in map: return stored key
  - Else: allocate next sequential key (e.g., `kCtxt${contextSeq++}`), store in WeakMap, return
- This ensures stable keys across repeated dumps while objects are alive, without inhibiting GC.

Lifecycle
- The key registry must be long-lived for the app session (module singleton or object held by the React wrapper). The dumper will depend on a reference to this registry.

Contexts, identity, and GC status
- Represent contexts as a pair: the runtime `GripContext` (held only via a `WeakRef`) and a durable `ContextNode` identity tracked by the key registry.
- When the `WeakRef<GripContext>` target is no longer alive, mark the JSON node with `gcStatus: "collected"` (alternatively: `"reaped"` or `"deleted"`). When alive, use `gcStatus: "live"`.
- If `WeakRef`/`FinalizationRegistry` is not available, omit `gcStatus` or report `gcStatus: "unknown"`.

---

### Core (React-agnostic) API

File: `src/core/graph_dump.ts` (new, no changes to existing files; this is a proposal)

Types
- `export interface GraphDump { timestampIso: string; summary: {...}; nodes: {...}; }`
- `export interface GraphDumpOptions { includeValues?: boolean; maxValueLength?: number; }`

Key registry
- `export class GraphDumpKeyRegistry { getContextKey(c: Context): string; getTapKey(t: Tap): string; getDripKey(d: Drip): string; }`

Dumper
- `export class GripGraphDumper {`
  - `constructor(args: { grok: Grok; keys?: GraphDumpKeyRegistry; opts?: GraphDumpOptions })`
  - `dump(): GraphDump`
  - Internals:
    - Discover root context(s) from `grok.context`
    - Traverse contexts (children), collect taps registered to each context
    - For each tap, collect provides/metadata and reachable drips, including:
      - incoming home/destination parameter drips (if exposed)
      - outgoing drips and destination contexts
    - For each drip, collect grip, value preview (optional), provider/deps
    - Build arrays with stable keys and cross-links
`}`

Traversal strategy
- Avoid deep or infinite graphs: cap depth and node counts with sane defaults (document these limits in code, e.g., depth<=10, nodes<=50k).
- Use visited sets (by object identity) to prevent cycles.

Safety
- Never mutate runtime objects.
- Read-only, best-effort reflection based on public APIs.
- If an internal field is not available via public API, omit gently.

Motivation
- This dump exists primarily to help identify potential leaks (e.g., contexts or drips persisting unexpectedly) and to enable external tooling or diagnostics to analyze the graph state offline.

---

### React Component API

Files: `src/react/GraphDumpDialog.tsx`, `src/react/GraphDumpButton.tsx`

GraphDumpDialog
- Props:
  - `open: boolean`
  - `onClose: () => void`
  - `grok: Grok`
  - `keys?: GraphDumpKeyRegistry` (optional injection for SSR/testing)
  - `options?: GraphDumpOptions`
- Behavior:
  - On `open` render, construct `GripGraphDumper` with provided `grok` and `keys` (or module-scope singleton registry).
  - Call `dump()` synchronously; store result in React local state for display.
  - Render JSON (pretty 2-space indent) in a scrollable code block.
  - Show timestamp prominently.
  - Copy button uses Clipboard API; on success, optionally flash a small confirmation (pure React state).
  - Dismiss button calls `onClose()`.
  - No Grip state is read/written for the UI.

GraphDumpButton
- A small wrapper rendering a button; manages `open` boolean in React state and renders `GraphDumpDialog` when true.
- Props:
  - `grok: Grok`
  - Optional: `label?: string` (default: "Dump Graph")

Embedding in demo
- In the existing centered control group (where "Hide/Show Graph" and "Refresh Graph" live), render `<GraphDumpButton grok={grok} />` next to them.

---

### Copy JSON Format
- Pretty-print with 2 spaces.
- Deterministic field order: `timestampIso`, `summary`, `nodes`.
- Deterministic ordering of arrays where practical (e.g., sort keys lexicographically) to minimize diff noise between dumps.
- Include only serializable data.

---

### Testing Plan
- Core unit tests for `GraphDumpKeyRegistry` to ensure stable keys and WeakMap semantics.
- Core unit tests for `GripGraphDumper` on a small synthetic graph:
  - Single context with a tap and a drip
  - Multiple contexts, nested
  - Repeat dump: keys remain stable
  - After GC (simulated by dropping references in tests), new objects get new keys
- React component tests (jsdom):
  - Dialog opens/closes
  - Copy calls Clipboard API
  - Snapshot of JSON block with a stubbed dumper

---

### Performance Considerations
- Dump runs on-demand (button click only), not on an interval.
- Traversal bounded by default limits; options allow power users to increase.
- Avoid expensive stringification of large values; `valuePreview` may truncate to `maxValueLength` (default ~200 chars).

---

### Future Enhancements (non-blocking)
- Optional filters (e.g., only contexts, only drips)
- UI search within JSON
- Export to file (download)
- Structured graph view next to raw JSON

---

### Implementation Notes
- Keep the dumper pure and side-effect free.
- Keep the key registry narrowly focused on identity->key mapping.
- Treat all runtime objects as opaque; prefer public APIs.
- Ensure the React pieces do not import from internal core paths beyond the exported dumper and types.


