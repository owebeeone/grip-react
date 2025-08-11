import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip } from "./drip";
import { Tap } from "./tap";
import { GrokGraph, GripContextNode } from "./graph";

export class Grok {
  private taps: Tap[] = [];
  private cache = new Map<string, Drip<any>>();
  private graph = new GrokGraph();

  readonly rootContext: GripContext;
  readonly mainContext: GripContext;

  constructor() {
    this.rootContext = new GripContext("root");
    this.mainContext = new GripContext("main").addParent(this.rootContext, 0);
    this.graph.ensureNode(this.rootContext);
    this.graph.ensureNode(this.mainContext);
  }

  private ensureNode(ctx: GripContext): GripContextNode {
    return this.graph.ensureNode(ctx);
  }

  // Create a new context optionally parented to a given context (defaults to main)
  createContext(id?: string, parent?: GripContext, priority = 0): GripContext {
    const ctx = new GripContext(id);
    if (parent ?? this.mainContext) ctx.addParent(parent ?? this.mainContext, priority);
    this.ensureNode(ctx);
    return ctx;
  }

  // Dispose a context: clears caches keyed by this ctx and lets the graph GC remove the node
  disposeContext(ctx: GripContext): void {
    // Clear cache entries for this ctx
    for (const key of Array.from(this.cache.keys())) {
      if (key.endsWith(`::${ctx.id}`)) this.cache.delete(key);
    }
    // Optionally: detach from parents to break strong references in contexts
    // There is no public API on GripContext to remove parents; we rely on graph WeakRef GC.
  }

  registerTap(tap: Tap): void {
    this.taps.push(tap);
  }

  // Central query API: component asks for a Grip from a Context => gets a Drip<T>
  query<T>(grip: Grip<T>, ctx: GripContext): Drip<T> {
    // Ensure nodes for ctx and all parents encountered
    this.ensureNode(ctx);

    // 1) Context overrides take precedence (track source context)
    const ovSrc = ctx.resolveOverrideWithSource(grip);
    if (ovSrc) {
      const { override, source } = ovSrc;
      if (override.type === "drip") {
        const drip = override.drip as Drip<T>;
        this.ensureNode(source).recordProducer(grip, { type: "override-drip", drip });
        this.ensureNode(ctx).recordConsumer(grip, drip);
        return drip;
      }
      if (override.type === "value") {
        const drip = new Drip<T>(override.value as T);
        this.ensureNode(source).recordProducer(grip, { type: "override-value", value: override.value });
        this.ensureNode(ctx).recordConsumer(grip, drip);
        return drip;
      }
    }

    // 2) Find best-matching Tap
    let bestTap: Tap | undefined;
    for (const tap of this.taps) {
      if (tap.provides.some(g => g.key === grip.key)) { bestTap = tap; break; }
    }

    // 3) Produce or fallback to default
    if (bestTap) {
      const k = `${bestTap.id}::${grip.key}::${ctx.id}`;
      const cached = this.cache.get(k);
      if (cached) {
        this.ensureNode(ctx).recordProducer(grip, { type: "tap", tapId: bestTap.id, drip: cached });
        this.ensureNode(ctx).recordConsumer(grip, cached);
        return cached as Drip<T>;
      }
      const drip = bestTap.produce<T>(grip, ctx, this);
      this.cache.set(k, drip);
      // Subscribe to parameter grip override changes on this context to invalidate cache (guarded)
      const unsubscribeFns: Array<() => void> = [];
      const invalidate = () => {
        this.cache.delete(k);
        unsubscribeFns.forEach(fn => fn());
      };
      const hasOnOC = typeof (ctx as any).onOverrideChange === 'function';
      if (hasOnOC) {
        unsubscribeFns.push((ctx as any).onOverrideChange(grip, invalidate));
        if (bestTap.parameterGrips) {
          for (const pg of bestTap.parameterGrips) {
            unsubscribeFns.push((ctx as any).onOverrideChange(pg, invalidate));
          }
        }
      }
      this.ensureNode(ctx).recordProducer(grip, { type: "tap", tapId: bestTap.id, drip });
      this.ensureNode(ctx).recordConsumer(grip, drip);
      return drip;
    }

    const fallback = new Drip<T>(grip.defaultValue as T);
    this.ensureNode(ctx).recordConsumer(grip, fallback);
    return fallback;
  }

  // Expose read-only snapshot of the graph for debugging/inspection
  getGraph(): ReadonlyMap<string, GripContextNode> {
    return this.graph.snapshot();
  }
}
