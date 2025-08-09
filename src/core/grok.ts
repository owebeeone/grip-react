import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip } from "./drip";
import { Tap } from "./tap";

type ProducerType = "tap" | "override-value" | "override-drip";

interface ProducerRecord {
  type: ProducerType;
  gripKey: string;
  tapId?: string;
  drip?: Drip<any>;
  value?: unknown;
}

interface ContextNode {
  ctx: GripContext;
  producers: Map<string, ProducerRecord[]>; // by grip.key
  consumers: Map<string, Set<Drip<any>>>;   // by grip.key
}

export class Grok {
  private taps: Tap[] = [];
  private cache = new Map<string, Drip<any>>();
  private graph = new Map<string, ContextNode>();

  readonly rootContext: GripContext;
  readonly mainContext: GripContext;

  constructor() {
    this.rootContext = new GripContext("root");
    this.mainContext = new GripContext("main").addParent(this.rootContext, 0);
    this.ensureContextNode(this.rootContext);
    this.ensureContextNode(this.mainContext);
  }

  private ensureContextNode(ctx: GripContext): ContextNode {
    let node = this.graph.get(ctx.id);
    if (!node) {
      node = { ctx, producers: new Map(), consumers: new Map() };
      this.graph.set(ctx.id, node);
    }
    return node;
  }

  private recordConsumer(ctx: GripContext, gripKey: string, drip: Drip<any>): void {
    const node = this.ensureContextNode(ctx);
    const set = node.consumers.get(gripKey) ?? new Set<Drip<any>>();
    set.add(drip);
    node.consumers.set(gripKey, set);
    // Also track on context for local bookkeeping
    // We need the Grip object to call context.addConsumerDrip; here we only have key, so skip.
  }

  private recordProducer(ctx: GripContext, rec: ProducerRecord): void {
    const node = this.ensureContextNode(ctx);
    const arr = node.producers.get(rec.gripKey) ?? [];
    // Avoid duplicate identical producer entries (by type+tapId+drip/value)
    const exists = arr.some(p => p.type === rec.type && p.tapId === rec.tapId && p.drip === rec.drip && p.value === rec.value);
    if (!exists) {
      arr.push(rec);
      node.producers.set(rec.gripKey, arr);
    }
  }

  registerTap(tap: Tap): void {
    this.taps.push(tap);
  }

  // Central query API: component asks for a Grip from a Context => gets a Drip<T>
  query<T>(grip: Grip<T>, ctx: GripContext): Drip<T> {
    // Ensure nodes for ctx and all parents encountered
    this.ensureContextNode(ctx);

    // 1) Context overrides take precedence (track source context)
    const ovSrc = ctx.resolveOverrideWithSource(grip);
    if (ovSrc) {
      const { override, source } = ovSrc;
      if (override.type === "drip") {
        const drip = override.drip as Drip<T>;
        this.recordProducer(source, { type: "override-drip", gripKey: grip.key, drip });
        this.recordConsumer(ctx, grip.key, drip);
        return drip;
      }
      if (override.type === "value") {
        const drip = new Drip<T>(override.value as T);
        this.recordProducer(source, { type: "override-value", gripKey: grip.key, value: override.value });
        this.recordConsumer(ctx, grip.key, drip);
        return drip;
      }
    }

    // 2) Find best-matching Tap
    let bestTap: Tap | undefined;
    let bestScore = -Infinity;
    for (const tap of this.taps) {
      if (!tap.provides.some(g => g.key === grip.key)) continue;
      const score = tap.match(ctx);
      if (score > bestScore) { bestScore = score; bestTap = tap; }
    }

    // 3) Produce or fallback to default
    if (bestTap && bestScore > -Infinity) {
      const k = `${bestTap.id}::${grip.key}::${ctx.id}`;
      const cached = this.cache.get(k);
      if (cached) {
        this.recordProducer(ctx, { type: "tap", gripKey: grip.key, tapId: bestTap.id, drip: cached });
        this.recordConsumer(ctx, grip.key, cached);
        return cached as Drip<T>;
      }
      const drip = bestTap.produce<T>(grip, ctx, this);
      this.cache.set(k, drip);
      this.recordProducer(ctx, { type: "tap", gripKey: grip.key, tapId: bestTap.id, drip });
      this.recordConsumer(ctx, grip.key, drip);
      return drip;
    }

    const fallback = new Drip<T>(grip.defaultValue as T);
    this.recordConsumer(ctx, grip.key, fallback);
    return fallback;
  }

  // Expose read-only snapshot of the graph for debugging/inspection
  getGraph(): ReadonlyMap<string, Readonly<ContextNode>> {
    return this.graph;
  }
}
