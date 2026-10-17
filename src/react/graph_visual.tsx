import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Grok, GripContextNode, Grip, Drip, Tap } from "@owebeeone/grip-core";
import { GraphDumpKeyRegistry } from "@owebeeone/grip-core";

export type GripGraphVisualizerProps = {
  grok: Grok;
  refreshMs?: number;
  showDestinationParams?: boolean;
  showResolvedProviders?: boolean;
  showUnresolvedConsumers?: boolean;
  showReapedContexts?: boolean;
  pause?: boolean;
  // If true, scales the graph down to fit the pane; if false, uses scrollbars when needed
  fitToPane?: boolean;
  direction?: 'vertical' | 'horizontal';
  className?: string;
  style?: React.CSSProperties;
  // A simple counter. Increment to force a refresh.
  refreshTrigger?: number;
  keys?: GraphDumpKeyRegistry; // shared registry for stable kXXX ids
};

type VisualNode = {
  id: string;
  display_id: string;
  node: GripContextNode;
  live: boolean;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  producers: Set<any>; // unique ProducerRecord instances
  consumers: Array<{ grip: Grip<any>; drip?: Drip<any>; value: any }>; // snapshot of current values
};

type ParentEdge = { kind: "parent"; id: string; from: string; to: string };
type ProviderEdge = {
  kind: "provider";
  id: string;
  from: string; // provider context id
  to: string; // destination context id
  grips: Array<{ grip: Grip<any>; value: any }>; // snapshot values at destination
};

const CARD_WIDTH = 280;
const CARD_HEIGHT = 160;
const H_GAP = 40;
const V_GAP = 60;
const PADDING = 24;
const CONTEXT_EDGE_COLOR = "#aab5c2";
const DATA_EDGE_COLOR = "#2e7d32";

function computeLayers(graph: ReadonlyMap<string, GripContextNode>): Map<string, number> {
  // roots: nodes with no parents
  const parentsById = new Map<string, string[]>();
  for (const [id, node] of graph) {
    parentsById.set(
      id,
      node
        .get_parent_nodes()
        .map((p) => p.id)
    );
  }
  const roots: string[] = [];
  for (const [id, parents] of parentsById) {
    if (parents.length === 0) roots.push(id);
  }
  const layer = new Map<string, number>();
  const queue: string[] = [...roots];
  for (const r of roots) layer.set(r, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLayer = layer.get(cur) ?? 0;
    // children: nodes that list cur as a parent
    for (const [id, parents] of parentsById) {
      if (parents.includes(cur)) {
        const next = Math.max((layer.get(id) ?? -1), curLayer + 1);
        const prev = layer.get(id);
        if (prev == null || next > prev) {
          layer.set(id, next);
          if (!queue.includes(id)) queue.push(id);
        }
      }
    }
  }
  // orphaned nodes (shouldn't happen): put at layer 0
  for (const id of graph.keys()) if (!layer.has(id)) layer.set(id, 0);
  return layer;
}

function uniqueProducerRecords(node: GripContextNode): Set<any> {
  const recs = new Set<any>();
  for (const [, rec] of node.get_producers()) recs.add(rec);
  return recs;
}

function snapshotConsumers(node: GripContextNode): Array<{ grip: Grip<any>; drip?: Drip<any>; value: any }> {
  const out: Array<{ grip: Grip<any>; drip?: Drip<any>; value: any }> = [];
  for (const [grip, wr] of node.get_consumers()) {
    const d = wr?.deref();
    if (d) out.push({ grip, drip: d as unknown as Drip<any>, value: (d as any).get() });
    else out.push({ grip, drip: undefined, value: (grip as any).defaultValue });
  }
  return out;
}

function buildVisual(
  grok: Grok,
  showReapedContexts: boolean,
  direction: 'vertical' | 'horizontal',
  keys: GraphDumpKeyRegistry
): { nodes: VisualNode[]; parentEdges: ParentEdge[]; providerEdges: ProviderEdge[]; canvas: { width: number; height: number } } {
  const graph = new Map([...grok.getGraph()].filter(([, node]) => showReapedContexts || !!node.get_context()));
  const layerMap = computeLayers(graph);
  const layers: Map<number, VisualNode[]> = new Map();
  let maxLayer = 0;

  // Build nodes
  for (const [id, node] of graph) {
    const live = !!node.get_context();
    const l = layerMap.get(id) ?? 0;
    maxLayer = Math.max(maxLayer, l);
    const vn: VisualNode = {
      id: keys.getContextKey(node),
      display_id: `${keys.getContextKey(node)} ${node.id}`,
      node,
      live,
      layer: l,
      x: 0,
      y: 0,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      producers: uniqueProducerRecords(node),
      consumers: snapshotConsumers(node),
    };
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(vn);
  }

  // Natural geometry; the component scales the complete canvas to fit.
  const layerCount = maxLayer + 1;
  const maxCols = Math.max(...Array.from(layers.values()).map((arr) => arr.length), 1);
  const horizontal = direction === 'horizontal';
  const columns = horizontal ? layerCount : maxCols;
  const rows = horizontal ? maxCols : layerCount;
  const requiredWidth = PADDING * 2 + columns * CARD_WIDTH + (columns - 1) * H_GAP;
  const requiredHeight = PADDING * 2 + rows * CARD_HEIGHT + (rows - 1) * V_GAP;
  // Keep cards, text, and edges at their natural size. The whole canvas is
  // transformed together by the viewer, so fit cannot shrink only card boxes.
  const scale = 1;
  const cardW = CARD_WIDTH * scale;
  const cardH = CARD_HEIGHT * scale;
  const gapX = H_GAP * scale;
  const gapY = V_GAP * scale;
  const padX = PADDING * scale;
  const padY = PADDING * scale;
  const scaledRequiredWidth = requiredWidth * scale;
  const scaledRequiredHeight = requiredHeight * scale;
  const canvasWidth = scaledRequiredWidth;
  const canvasHeight = scaledRequiredHeight;
  const offsetX = 0;
  const offsetY = 0;
  for (const [l, arr] of layers) {
    arr.sort((a, b) => a.id.localeCompare(b.id));
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const x = offsetX + padX + (horizontal ? l : (maxCols - n) / 2 + i) * (cardW + gapX);
      const y = offsetY + padY + (horizontal ? (maxCols - n) / 2 + i : l) * (cardH + gapY);
      arr[i].x = x;
      arr[i].y = y;
      arr[i].width = cardW;
      arr[i].height = cardH;
    }
  }

  // Parent edges
  const parentEdges: ParentEdge[] = [];
  for (const vn of Array.from(layers.values()).flat()) {
    for (const p of vn.node.get_parent_nodes()) {
      parentEdges.push({ kind: "parent", id: `parent:${vn.id}->${keys.getContextKey(p)}`, from: vn.id, to: keys.getContextKey(p) });
    }
  }

  // Provider edges
  const providerEdges: ProviderEdge[] = [];
  for (const vn of Array.from(layers.values()).flat()) {
    // For each unique producer record
    for (const rec of vn.producers) {
      for (const [destNode, destination] of rec.getDestinations()) {
        const destCtx = destNode.get_context();
        if (!destCtx) continue;
        const grips = Array.from(destination.getGrips() as ReadonlySet<Grip<any>>).map((g: Grip<any>) => {
          const val = destCtx._getContextNode().getLiveDripForGrip(g as any)?.get();
          return { grip: g, value: val };
        });
        providerEdges.push({ kind: "provider", id: `prov:${vn.id}->${keys.getContextKey(destNode)}:${providerEdges.length}`, from: vn.id, to: keys.getContextKey(destNode), grips });
      }
    }
  }

  return { nodes: Array.from(layers.values()).flat(), parentEdges, providerEdges, canvas: { width: canvasWidth, height: canvasHeight } };
}

export function GripGraphVisualizer(props: GripGraphVisualizerProps) {
  const { grok, refreshMs = 500, showDestinationParams = false, showResolvedProviders = true, showUnresolvedConsumers = true, showReapedContexts = true, pause = false, fitToPane = false, direction = 'vertical', className, style, refreshTrigger = 0 } = props;
  const ownKeys = useMemo(() => new GraphDumpKeyRegistry(), []);
  const keys = props.keys ?? ownKeys;

  const [nodes, setNodes] = useState<VisualNode[]>([]);
  const [parentEdges, setParentEdges] = useState<ParentEdge[]>([]);
  const [providerEdges, setProviderEdges] = useState<ProviderEdge[]>([]);
  const [canvas, setCanvas] = useState<{ width: number; height: number }>({ width: 800, height: 600 });
  const [viewport, setViewport] = useState({ w: 800, h: 600 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fittedScale = fitToPane ? Math.max(.05, Math.min(1, viewport.w / canvas.width, viewport.h / canvas.height)) : 1;

  useEffect(() => {
    let cancelled = false;
    function measureViewport(): { w: number; h: number } {
      const el = containerRef.current;
      if (el) {
        const r = (el as HTMLDivElement).getBoundingClientRect();
        return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      }
      return { w: 800, h: 600 };
    }
    function tick() {
      const { w, h } = measureViewport();
      const { nodes, parentEdges, providerEdges, canvas } = buildVisual(grok, showReapedContexts, direction, keys);
      if (cancelled) return;
      setNodes(nodes);
      setParentEdges(parentEdges);
      setProviderEdges(providerEdges);
      setCanvas(canvas);
      setViewport({ w, h });
    }
    tick();
    const timer = pause ? undefined : setInterval(tick, Math.max(100, refreshMs));
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(tick) : undefined;
    if (containerRef.current) observer?.observe(containerRef.current);
    return () => { cancelled = true; clearInterval(timer); observer?.disconnect(); };
  }, [grok, refreshMs, pause, showResolvedProviders, showUnresolvedConsumers, showReapedContexts, fitToPane, direction, refreshTrigger, keys]);

  const containerStyle: React.CSSProperties = useMemo(() => ({
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    background: "#fafafa",
    color: "#213547",
    textAlign: "left",
    ...style,
  }), [style]);

  const svgStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    pointerEvents: "none",
  };

  const nodeCard = (vn: VisualNode) => {
    // Flag contexts with sanity issues in red
    const hasIssues = (vn.node as any)._sanityIssues?.length > 0;
    const headerBg = hasIssues ? "#c62828" : (vn.live ? "#1e88e5" : "#9e9e9e");
    const cardOpacity = !vn.live && showReapedContexts ? 0.6 : vn.live ? 1 : showReapedContexts ? 0.6 : 0; // hide reaped if not showing
    if (!vn.live && !showReapedContexts) return null;
    const consumers = vn.consumers
      .filter((c) => showUnresolvedConsumers || c.drip)
      .slice(0, 6);
    const producersCount = vn.producers.size;
    return (
      <div key={vn.id} role="group" aria-label={`Context ${vn.node.id}`} style={{ position: "absolute", left: vn.x, top: vn.y, width: vn.width, height: vn.height, border: "1px solid #ddd", borderRadius: 8, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", opacity: cardOpacity }}>
        <div style={{ background: headerBg, color: "#fff", padding: "6px 10px", borderTopLeftRadius: 8, borderTopRightRadius: 8, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
          <div title={vn.display_id} style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: vn.width - 90 }}>{vn.display_id}{hasIssues ? " · Drip unsubscribe failed" : ""}</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>{producersCount} taps · {vn.consumers.length} drips</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8, padding: 10, fontSize: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Taps</div>
            <div style={{ maxHeight: 90, overflow: "auto" }}>
              {producersCount === 0 ? <div style={{ color: "#999" }}>—</div> : Array.from(vn.producers).slice(0, 6).map((rec: any, i: number) => (
                <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rec?.tap?.constructor?.name ?? "Tap"}</div>
              ))}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Drips</div>
            <div style={{ maxHeight: 90, overflow: "auto" }}>
              {consumers.length === 0 ? <div style={{ color: "#999" }}>—</div> : consumers.map((c, i) => (
                <div key={i} title={(c.grip as any).key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(c.grip as any).key}</span>
                  <span title={String(c.value)} style={{ flex: 1, minWidth: 0, color: "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{String(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const findNode = (id: string) => nodes.find((n) => n.id === id);

  const parentLines = parentEdges.map((e) => {
    const from = findNode(e.from);
    const to = findNode(e.to);
    if (!from || !to) return null;
    const horizontal = direction === 'horizontal';
    const x1 = from.x + (horizontal ? 0 : from.width / 2);
    const y1 = from.y + (horizontal ? from.height / 2 : 0);
    const x2 = to.x + (horizontal ? to.width : to.width / 2);
    const y2 = to.y + (horizontal ? to.height / 2 : to.height);
    const curve = horizontal ? `C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}` : `C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
    return <path key={e.id} d={`M ${x1} ${y1} ${curve}`} stroke={CONTEXT_EDGE_COLOR} fill="none" strokeWidth={1} markerEnd="url(#arrow-grey)" />;
  });

  const providerLines = showResolvedProviders ? providerEdges.map((e) => {
    const from = findNode(e.from);
    const to = findNode(e.to);
    if (!from || !to) return null;
    const horizontal = direction === 'horizontal';
    const x1 = from.x + (horizontal ? from.width : from.width / 2);
    const y1 = from.y + (horizontal ? from.height / 2 : from.height);
    const x2 = to.x + (horizontal ? 0 : to.width / 2);
    const y2 = to.y + (horizontal ? to.height / 2 : 0);
    const curve = horizontal ? `C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}` : `C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
    const title = e.grips.map((g) => `${(g.grip as any).key}: ${String(g.value)}`).join("\n");
    return <path key={e.id} data-edge-kind="provider" d={`M ${x1} ${y1} ${curve}`} stroke={DATA_EDGE_COLOR} fill="none" strokeWidth={2} opacity={0.85} markerEnd="url(#arrow-green)"><title>{title}</title></path>;
  }) : [];

  return (
    <div className={className} style={containerStyle}>
      <div role="note" aria-label="Graph legend" style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px", padding: "8px 12px", fontSize: 12, flexShrink: 0, borderBottom: "1px solid #e2e6eb" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true" style={{ width: 28, borderTop: `1px solid ${CONTEXT_EDGE_COLOR}` }} />
          Context links: child → parent
        </span>
        {showResolvedProviders && <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden="true" style={{ width: 28, borderTop: `2px solid ${DATA_EDGE_COLOR}` }} />
          Data flow: provider → consumer
        </span>}
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {/* Content area sized to graph; centered */}
      <div style={{ position: "relative", width: Math.max(viewport.w, canvas.width * fittedScale), height: Math.max(viewport.h, canvas.height * fittedScale) }}>
      <div data-testid="graph-transform" style={{ position: "absolute", width: canvas.width, height: canvas.height,
        left: Math.max(0, (viewport.w - canvas.width * fittedScale) / 2),
        top: Math.max(0, (viewport.h - canvas.height * fittedScale) / 2),
        transform: `scale(${fittedScale})`, transformOrigin: 'top left' }}>
        {/* SVG edges */}
        <svg width={canvas.width} height={canvas.height} style={svgStyle}>
        <defs>
          <marker id="arrow-grey" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L6,3 L0,6 Z" fill={CONTEXT_EDGE_COLOR} />
          </marker>
          <marker id="arrow-green" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,4 L0,8 Z" fill={DATA_EDGE_COLOR} />
          </marker>
        </defs>
        {parentLines}
        {providerLines}
        </svg>
        {/* Nodes */}
        {nodes.map(nodeCard)}
      </div>
      </div>
      </div>
    </div>
  );
}

export default GripGraphVisualizer;


