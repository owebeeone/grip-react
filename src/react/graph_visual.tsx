import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Grok } from "../core/grok";
import type { GripContextNode } from "../core/graph";
import type { Grip } from "../core/grip";
import type { Drip } from "../core/drip";
import type { Tap } from "../core/tap";

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
  className?: string;
  style?: React.CSSProperties;
  // A simple counter. Increment to force a refresh.
  refreshTrigger?: number;
};

type VisualNode = {
  id: string;
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
  showResolvedProviders: boolean,
  showUnresolvedConsumers: boolean,
  viewportWidth: number,
  viewportHeight: number,
  fitToPane: boolean
): { nodes: VisualNode[]; parentEdges: ParentEdge[]; providerEdges: ProviderEdge[]; canvas: { width: number; height: number } } {
  const graph = grok.getGraph();
  const layerMap = computeLayers(graph);
  const layers: Map<number, VisualNode[]> = new Map();
  let maxLayer = 0;

  // Build nodes
  for (const [id, node] of graph) {
    const live = !!node.get_context();
    const l = layerMap.get(id) ?? 0;
    maxLayer = Math.max(maxLayer, l);
    const vn: VisualNode = {
      id,
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

  // Compute scaling to fill viewport
  const layerCount = maxLayer + 1;
  const maxCols = Math.max(...Array.from(layers.values()).map((arr) => arr.length), 1);
  const requiredWidth = PADDING * 2 + maxCols * CARD_WIDTH + (maxCols - 1) * H_GAP;
  const requiredHeight = PADDING * 2 + layerCount * CARD_HEIGHT + (layerCount - 1) * V_GAP;
  const fitW = viewportWidth / Math.max(1, requiredWidth);
  const fitH = viewportHeight / Math.max(1, requiredHeight);
  const fit = Math.min(fitW, fitH);
  const scale = fitToPane ? Math.min(1, isFinite(fit) && fit > 0 ? fit : 1) : 1; // shrink only when asked
  const cardW = CARD_WIDTH * scale;
  const cardH = CARD_HEIGHT * scale;
  const gapX = H_GAP * scale;
  const gapY = V_GAP * scale;
  const padX = PADDING * scale;
  const padY = PADDING * scale;
  const scaledRequiredWidth = requiredWidth * scale;
  const scaledRequiredHeight = requiredHeight * scale;
  const canvasWidth = fitToPane ? viewportWidth : Math.max(viewportWidth, scaledRequiredWidth);
  const canvasHeight = fitToPane ? viewportHeight : Math.max(viewportHeight, scaledRequiredHeight);
  const offsetX = Math.max(0, (viewportWidth - scaledRequiredWidth) / 2);
  const offsetY = Math.max(0, (viewportHeight - scaledRequiredHeight) / 2);
  for (const [l, arr] of layers) {
    arr.sort((a, b) => a.id.localeCompare(b.id));
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const x = offsetX + padX + i * (cardW + gapX);
      const y = offsetY + padY + l * (cardH + gapY);
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
      parentEdges.push({ kind: "parent", id: `parent:${vn.id}->${p.id}`, from: vn.id, to: p.id });
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
        providerEdges.push({ kind: "provider", id: `prov:${vn.id}->${destNode.id}:${providerEdges.length}`, from: vn.id, to: destNode.id, grips });
      }
    }
  }

  return { nodes: Array.from(layers.values()).flat(), parentEdges, providerEdges, canvas: { width: canvasWidth, height: canvasHeight } };
}

export function GripGraphVisualizer(props: GripGraphVisualizerProps) {
  const { grok, refreshMs = 500, showDestinationParams = false, showResolvedProviders = true, showUnresolvedConsumers = true, showReapedContexts = true, pause = false, fitToPane = false, className, style, refreshTrigger = 0 } = props;

  const [nodes, setNodes] = useState<VisualNode[]>([]);
  const [parentEdges, setParentEdges] = useState<ParentEdge[]>([]);
  const [providerEdges, setProviderEdges] = useState<ProviderEdge[]>([]);
  const [canvas, setCanvas] = useState<{ width: number; height: number }>({ width: 800, height: 600 });

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
      const { nodes, parentEdges, providerEdges, canvas } = buildVisual(grok, showResolvedProviders, showUnresolvedConsumers, w, h, fitToPane);
      if (cancelled) return;
      setNodes(nodes);
      setParentEdges(parentEdges);
      setProviderEdges(providerEdges);
      setCanvas(canvas);
      if (!cancelled && !pause) setTimeout(tick, refreshMs);
    }
    tick();
    return () => { cancelled = true; };
  }, [grok, refreshMs, pause, showResolvedProviders, showUnresolvedConsumers, fitToPane, refreshTrigger]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerStyle: React.CSSProperties = useMemo(() => ({
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "auto",
    background: "#fafafa",
    ...style,
  }), [style]);

  const svgStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    pointerEvents: "none",
  };

  const nodeCard = (vn: VisualNode) => {
    const headerBg = vn.live ? "#1e88e5" : "#9e9e9e";
    const cardOpacity = !vn.live && showReapedContexts ? 0.6 : vn.live ? 1 : showReapedContexts ? 0.6 : 0; // hide reaped if not showing
    if (!vn.live && !showReapedContexts) return null;
    const consumers = vn.consumers
      .filter((c) => showUnresolvedConsumers || c.drip)
      .slice(0, 6);
    const producersCount = vn.producers.size;
    return (
      <div key={vn.id} style={{ position: "absolute", left: vn.x, top: vn.y, width: vn.width, height: vn.height, border: "1px solid #ddd", borderRadius: 8, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", opacity: cardOpacity }}>
        <div style={{ background: headerBg, color: "#fff", padding: "6px 10px", borderTopLeftRadius: 8, borderTopRightRadius: 8, fontSize: 13, display: "flex", justifyContent: "space-between" }}>
          <div title={vn.id} style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: vn.width - 90 }}>{vn.id}</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>{producersCount} taps · {vn.consumers.length} drips</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 10, fontSize: 12 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Taps</div>
            <div style={{ maxHeight: 90, overflow: "auto" }}>
              {producersCount === 0 ? <div style={{ color: "#999" }}>—</div> : Array.from(vn.producers).slice(0, 6).map((rec: any, i: number) => (
                <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rec?.tap?.constructor?.name ?? "Tap"}</div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Drips</div>
            <div style={{ maxHeight: 90, overflow: "auto" }}>
              {consumers.length === 0 ? <div style={{ color: "#999" }}>—</div> : consumers.map((c, i) => (
                <div key={i} title={(c.grip as any).key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{(c.grip as any).key}</span>
                  <span style={{ color: "#555", maxWidth: 110, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{String(c.value)}</span>
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
    const x1 = from.x + from.width / 2;
    const y1 = from.y;
    const x2 = to.x + to.width / 2;
    const y2 = to.y + to.height;
    return <line key={e.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#bbb" strokeWidth={1} markerEnd="url(#arrow-grey)" />;
  });

  const providerLines = providerEdges.map((e) => {
    const from = findNode(e.from);
    const to = findNode(e.to);
    if (!from || !to) return null;
    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height / 2;
    const x2 = to.x + to.width / 2;
    const y2 = to.y + to.height / 2;
    // Straight line; could be improved to spline
    const title = e.grips.map((g) => `${(g.grip as any).key}: ${String(g.value)}`).join("\n");
    return <line key={e.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2e7d32" strokeWidth={2} opacity={0.85} markerEnd="url(#arrow-green)"><title>{title}</title></line>;
  });

  return (
    <div ref={containerRef} className={className} style={containerStyle}>
      {/* Content area sized to graph; centered */}
      <div style={{ position: "relative", width: canvas.width, height: canvas.height, margin: "0 auto" }}>
        {/* SVG edges */}
        <svg width={canvas.width} height={canvas.height} style={svgStyle}>
        <defs>
          <marker id="arrow-grey" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L6,3 L0,6 Z" fill="#bbb" />
          </marker>
          <marker id="arrow-green" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,4 L0,8 Z" fill="#2e7d32" />
          </marker>
        </defs>
        {parentLines}
        {providerLines}
        </svg>
        {/* Nodes */}
        {nodes.map(nodeCard)}
      </div>
    </div>
  );
}

export default GripGraphVisualizer;


