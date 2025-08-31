### Grip Graph Visualizer – Component Specification

#### Purpose
An interactive React component that visualizes the live Grip graph managed by `Grok`. It shows contexts, taps, and drips; how contexts inherit; and how grips flow from taps to destination contexts. It’s a diagnostic/inspection tool to understand producer/consumer relationships, shadowing, and current values.

#### High-level requirements
- Render `GripContext` and its corresponding `GripContextNode` as a single visual node.
  - If the `GripContext` has been reaped (WeakRef resolves to undefined), render the node “greyed-out”.
- Layout contexts top-down by ancestry (roots at top; children layered below), preserving multi-parent DAG relationships.
- Within each context node, render that context’s Taps and Drips.
- Draw edges that represent:
  - Context parent links (context → parent context)
  - Production links (tap in source/home context → destination context’s associated consumer drips)
  - Destination param dependencies (optional/toggle; dashed lines)
- Hovering edges between taps and destinations reveals which `Grip`s are linked (by name), and their current values if known.
- Show current values for Drips and (where feasible) for Taps.
- Live refresh (polling or event-like) to keep values/structure up-to-date, with a pause toggle.

#### Component API (proposal)
```ts
type GripGraphVisualizerProps = {
  grok: Grok; // engine instance to inspect
  // refresh interval for polling snapshot & live values (ms)
  refreshMs?: number; // default 500
  // toggles
  showDestinationParams?: boolean; // default false
  showResolvedProviders?: boolean; // default true
  showUnresolvedConsumers?: boolean; // default true
  showReapedContexts?: boolean; // default true (greyed-out)
  pause?: boolean; // controlled pause (optional)
  // selection/highlighting
  initialFocusContextId?: string;
  onSelectContext?: (ctxId: string) => void;
  onSelectTap?: (tapId: string) => void; // tap identity: `${homeCtxId}::${tapIndex}` or similar
  onSelectGrip?: (gripKey: string) => void; // `${scope}:${name}`
};
```

#### Data sources/mapping
- Graph snapshot: `grok.getGraph()` returns `ReadonlyMap<string, GripContextNode>`.
  - Context display name: `context.id` from `GripContext` if live; fallback to node id.
  - Reaped check: `node.get_context()` returns undefined => greyed-out context node.
  - Parent edges: `node.get_parent_nodes()`.
  - Producers per context: `node.get_producers(): Map<Grip<any>, ProducerRecord>`.
    - ProducerRecord → `tap`, `getDestinations()`.
  - Consumers per context: `node.get_consumers(): Map<Grip<any>, WeakRef<Drip<any>>>`.
    - Live drips: `wr.deref()`.
  - Resolved providers: `node.getResolvedProviders(): Map<Grip<any>, GripContextNode>`.
- Destination links:
  - For each ProducerRecord destination D: list the “output grips” that the destination is subscribed to (`Destination.getGrips()`).
  - For hover tooltip, enumerate those grips and provide the current consumer values at the destination context via `destCtx._getContextNode().getLiveDripForGrip(grip)?.get()`.
- Destination parameter drips (optional/dashed edges):
  - If `tap.destinationParamGrips` exists, draw dashed edges from destination context to the tap indicating dependency.
  - Values can be displayed using `Destination.getDestinationParamValue(grip)`.

#### Layout
- Build layers with a topological BFS from all root contexts (`ctx.isRoot() === true`).
  - Roots at layer 0, children at increasing layers; handle multi-parent by placing a node at the max(parentLayer + 1) observed.
- Within each context node:
  - Header: context id, greyed if reaped, badge with counts (taps, drips, destinations).
  - Sections: Taps (provides list), Drips (consumers list), optionally parameters.
  - Drips show current value (stringified; truncate long strings with tooltip).
  - Taps show provides grips (by key) and destination count.
- Edge types & styling:
  - Context parent edges: thin, neutral color.
  - Producer → destination edges: thicker, colored (e.g., green). Tooltip on hover lists grips and values.
  - Destination param edges: dashed purple (optional/toggle).

#### Interactions
- Hover on context node: show mini-panel with parents/children counts and last seen timestamp.
- Hover on producer→destination edge: show tooltip:
  - Provider tap info (home context id, provides grips)
  - Destination context id
  - “Grips delivered”: list of grip keys → destination consumer current value
- Click context: select and highlight its inbound/outbound edges; optionally focus panel with more details (parents, children, producers, consumers, resolved providers map).
- Click tap: highlight all destination edges and the provided grips.
- Search box: filter by context id, grip key, or tap id (highlight matches and dim others).
- Controls:
  - Pause/resume live updates
  - Toggles: show destination params, unresolved consumers, reaped nodes
  - Fit-to-screen and zoom controls

#### Live updates & performance
- Poll the snapshot every `refreshMs` (default 500ms). Debounce re-layout; recompute positions only if structure changed (contexts/parents/destinations). Values can update more frequently without re-layout.
- For large graphs, virtualize detail panels; collapse node internals until expanded.
- Avoid strong references to contexts/drips; rely on `WeakRef` and guard `deref()` results.
- Optional: group identical destination parameter sets, or per-location batching (as in WeatherTap) for value previews.

#### Value rendering
- Drips: `drip.get()` if live; fallback to the `Grip.defaultValue` if no live drip.
- Taps: show provides list; for a sampled destination (or aggregate) show last computed values if available via destination’s consumer drips; otherwise show count of destinations and grips.

#### Visual encoding (suggested)
- Context node: rounded rectangle.
  - Live: white background; title bar in blue.
  - Reaped: grey background, 50% opacity; title bar in grey.
- Tap: pill/badge in green; lists provided grips (keys).
- Drip: small row item with grip key and current value; orange accent.
- Edges:
  - Parent: grey thin lines with arrows upward.
  - Producer→destination: green thick lines; hover tooltip shows grips.
  - Destination param: purple dashed lines from destination context to tap.

#### Non-goals (initial version)
- No mutation controls (read-only inspector).
- No historical timeline or diff view.
- No persistence/export (future enhancement).

#### Technology
- React (existing app)
- Graph layout: d3-force/d3-dag or Elk/ELKJS; or a UI lib like `vis-network` for hierarchical layout.
- Tooltips: lightweight portal + CSS, or Tippy.js.

#### Recommendations (stack and approach)
- Use React Flow for rendering, interaction, zoom/pan, and custom nodes/edges.
- Use elkjs for layered DAG layout (top-down): set `elk.direction=DOWN` and only recompute on structural changes.
- Keep node/edge IDs stable; update positions/labels via `setNodes`/`setEdges`.
- Use Tippy.js (or similar) for hover tooltips on edges and nodes.
- Poll `grok.getGraph()` (e.g., 500ms) to refresh values; diff structure to decide when to re-layout.
- Map:
  - Context → React Flow node (custom node component). Grey if `node.get_context()` is undefined.
  - Parent link → grey edge.
  - Producer→destination → green edge (thicker). Edge data lists grips; tooltip shows current dest values.
  - Destination param dep (optional) → dashed purple edge from destination context to provider tap.

#### Minimal integration sketch
```ts
import ELK from 'elkjs/lib/elk.bundled.js';
import { useEffect, useState } from 'react';
import ReactFlow, { Node, Edge } from 'reactflow';

function useGripGraphAdapter(grok: Grok, refreshMs = 500) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  useEffect(() => {
    let cancelled = false;
    const elk = new ELK();
    async function tick() {
      const graph = grok.getGraph();
      // 1) Build elk children/edges from contexts and parent links
      const children = [] as any[]; const elkEdges = [] as any[];
      for (const [id, node] of graph) {
        children.push({ id, width: 260, height: 160 });
        for (const p of node.get_parent_nodes()) {
          elkEdges.push({ id: `${id}->${p.id}` , sources: [id], targets: [p.id] });
        }
      }
      const layout = await elk.layout({ id: 'root', layoutOptions: { 'elk.direction': 'DOWN' }, children, edges: elkEdges });
      if (cancelled) return;
      const pos = new Map(layout.children.map((c: any) => [c.id, { x: c.x, y: c.y }]));
      // 2) Map to React Flow nodes
      const rfNodes: Node[] = [];
      const rfEdges: Edge[] = [];
      for (const [id, node] of graph) {
        const live = !!node.get_context();
        rfNodes.push({ id, position: pos.get(id)!, data: { node }, type: 'contextNode', style: live ? {} : { opacity: 0.5 } });
        for (const p of node.get_parent_nodes()) {
          rfEdges.push({ id: `parent:${id}->${p.id}`, source: id, target: p.id, type: 'parentEdge' });
        }
        // Producer→destination edges
        for (const [, rec] of node.get_producers()) {
          for (const [destNode] of rec.getDestinations()) {
            rfEdges.push({ id: `prod:${node.id}->${destNode.id}`, source: node.id, target: destNode.id, type: 'providerEdge', data: { rec, dest: destNode } });
          }
        }
      }
      setNodes(rfNodes); setEdges(rfEdges);
      if (!cancelled) setTimeout(tick, refreshMs);
    }
    tick();
    return () => { cancelled = true; };
  }, [grok, refreshMs]);
  return { nodes, edges };
}
```

#### Edge cases
- Reaped contexts: ensure they display greyed; hide internal drips/taps if deref fails.
- WeakRefs may deref to undefined between frames—guard accordingly and degrade gracefully.
- Unresolved consumers: display drip rows with a “no provider” state (e.g., italic, default value shown).

#### Testing/verification checklist
- When a context is removed/unmounted, it turns greyed within one refresh cycle.
- Adding/removing a parent re-layers the DAG correctly.
- Adding/removing a tap shows/hides producer edges to destinations.
- Shadowing switches provider edges appropriately (nearest provider wins).
- Hover edge tooltips list correct grip keys and live values.
- Toggling destination-params shows/hides dashed edges; values match param drips.
- Pause stops updates; resume restarts them.

#### Future enhancements
- Record/playback mode to inspect historical states.
- Edge coloring by grip scope; per-grip filtering.
- Click-to-pin value watch list (track a set of drips/taps in a side panel).
- Export snapshot as JSON or SVG.


