import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip } from "./drip";
import { Tap } from "./tap";
import { GrokGraph, GripContextNode } from "./graph";
import { SimpleResolver } from "./resolver";

export class Grok {
  private taps: Tap[] = [];
  private cache = new Map<string, Drip<any>>();
  private graph = new GrokGraph();
  private resolver = new SimpleResolver();
  // Context -> taps registered at that context
  private providersByContext = new Map<string, Set<Tap>>();
  // Tap id -> set of context ids where it's registered
  private tapToContexts = new Map<string, Set<string>>();

  readonly rootContext: GripContext;
  readonly mainContext: GripContext;

  constructor() {
    this.rootContext = new GripContext("root");
    this.mainContext = new GripContext("main").addParent(this.rootContext, 0);
    this.graph.ensureNode(this.rootContext);
    this.graph.ensureNode(this.mainContext);
    // Initialize resolver parent links
    this.resolver.setParents(this.rootContext.id, []);
    this.resolver.setParents(this.mainContext.id, [{ id: this.rootContext.id, priority: 0 }]);
  }

  private ensureNode(ctx: GripContext): GripContextNode {
    return this.graph.ensureNode(ctx);
  }

  // Create a new context optionally parented to a given context (defaults to main)
  createContext(id?: string, parent?: GripContext, priority = 0): GripContext {
    const ctx = new GripContext(id);
    if (parent ?? this.mainContext) ctx.addParent(parent ?? this.mainContext, priority);
    this.ensureNode(ctx);
    // update resolver parents
    const parents = ctx.getParents().map(p => ({ id: p.ctx.id, priority: p.priority }));
    this.resolver.setParents(ctx.id, parents);
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
    // Default registration at main context
    this.registerTapAt(this.mainContext, tap);
  }

  registerTapAt(ctx: GripContext, tap: Tap): void {
    // Track in simple array for compatibility
    this.taps.push(tap);
    // Index by context
    const set = this.providersByContext.get(ctx.id) ?? new Set<Tap>();
    set.add(tap);
    this.providersByContext.set(ctx.id, set);
    // Index by tap id
    const ctxSet = this.tapToContexts.get(tap.id) ?? new Set<string>();
    ctxSet.add(ctx.id);
    this.tapToContexts.set(tap.id, ctxSet);
    // Inform resolver for each provided grip
    for (const g of tap.provides) {
      this.resolver.registerLocalProvider(ctx.id, g.key);
    }
    this.resolver.propagateAdd(ctx.id, new Set(tap.provides.map(g => g.key)));
  }

  unregisterTap(tapId: string): void {
    const contexts = Array.from(this.tapToContexts.get(tapId) ?? []);
    this.taps = this.taps.filter(t => t.id !== tapId);
    // Remove from indices and resolver
    for (const ctxId of contexts) {
      const providers = this.providersByContext.get(ctxId);
      if (providers) {
        for (const t of Array.from(providers)) {
          if (t.id === tapId) providers.delete(t);
        }
        if (providers.size === 0) this.providersByContext.delete(ctxId);
      }
      // propagate removal for all grips provided by this tap
      const tap = undefined as unknown as Tap | undefined;
      // We no longer have the tap object after filtering; get grips from cache keys or skip
      // For MVP, we'll remove mappings for any grip that had cache entries for this tap at any ctx
      // and let next query re-resolve. We still need to notify resolver: best effort by scanning known grips from cache keys.
      const gripKeys = new Set<string>();
      for (const key of Array.from(this.cache.keys())) {
        if (key.startsWith(`${tapId}::`)) {
          const parts = key.split("::");
          if (parts.length >= 3) gripKeys.add(parts[1]);
        }
      }
      if (gripKeys.size > 0) this.resolver.propagateRemove(ctxId, gripKeys);
    }
    this.tapToContexts.delete(tapId);
    // Evict any cached drips produced by this tap
    for (const key of Array.from(this.cache.keys())) {
      if (key.startsWith(`${tapId}::`)) this.cache.delete(key);
    }
  }

  // Central query API: component asks for a Grip from a Context => gets a Drip<T>
  query<T>(grip: Grip<T>, ctx: GripContext): Drip<T> {
    // Ensure nodes for ctx and all parents encountered
    this.ensureNode(ctx);
    // Keep resolver parent links in sync for contexts created outside Grok.createContext
    const parentsForResolver = ctx.getParents().map(p => ({ id: p.ctx.id, priority: p.priority }));
    this.resolver.setParents(ctx.id, parentsForResolver);

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

    // 2) Find provider via resolver mapping (proximity-based). If absent, resolve on the fly.
    let providerCtxId = this.resolver.getResolvedProvider(ctx.id, grip.key);
    if (!providerCtxId) {
      providerCtxId = this.resolver.resolveUpward(ctx.id, grip.key) as string | undefined;
    }
    // Map provider context -> tap that provides this grip
    let bestTap: Tap | undefined;
    if (providerCtxId) {
      const providerSet = this.providersByContext.get(providerCtxId);
      if (providerSet) {
        for (const t of providerSet) {
          if (t.provides.some(g => g.key === grip.key)) { bestTap = t; break; }
        }
      }
    } else {
      // No provider found in resolver; fallback to none → default below
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
      // If the tap declares parameterGrips and any are drips, subscribe to their changes directly
      if (bestTap.parameterGrips) {
        for (const pg of bestTap.parameterGrips) {
          const ov = ctx.resolveOverride(pg);
          if (ov?.type === 'drip') {
            const unsub = ov.drip.subscribe(() => {
              this.cache.delete(k);
            });
            // We don't keep unsubscribe here for MVP; cache will be evicted and next query will reattach
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
