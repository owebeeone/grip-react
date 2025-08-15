import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip } from "./drip";
import { Tap } from "./tap";
import { GrokGraph, GripContextNode, ProducerRecord } from "./graph";
import { DualContextContainer } from "./containers";
import type { GripContextLike } from "./containers";
import { SimpleResolver } from "./resolver";
import { TaskHandleHolder, TaskQueue } from "./task_queue";

function intersection<T>(setA: Set<T>, iterable: Iterable<T>): Set<T> {
  const result = new Set<T>();
  for (const item of iterable) {
    if (setA.has(item)) {
      result.add(item);
    }
  }
  return result;
}

function difference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of setA) {
    if (!setB.has(item)) {
      result.add(item);
    }
  }
  return result;
}

/**
 * The Grok engine.
 * 
 * This is the main class for the the Grip system's engine.
 *
 * All related objects, Drips, Contexts, Taps, etc. have access to one Grok instance.
 * 
 */
export class Grok {
  private graph = new GrokGraph(this);
  private resolver = new SimpleResolver();
  // Context -> taps registered at that context
  private providersByContext = new Map<string, Set<Tap>>();
  // Tap instance -> set of context ids where it's registered
  private tapToContexts = new Map<Tap, Set<string>>();

  private taskQueue = new TaskQueue({ autoFlush: false, useMicrotask: false });

  readonly rootContext: GripContext;
  readonly mainContext: GripContext;

  constructor() {
    this.rootContext = new GripContext(this, "root");
    this.mainContext = new GripContext(this, "main").addParent(this.rootContext, 0);
    // Link contexts back to this engine for base tap discovery
    (this.rootContext as any).__grok = this;
    (this.mainContext as any).__grok = this;
    this.graph.ensureNode(this.rootContext);
    this.graph.ensureNode(this.mainContext);
    // Initialize resolver parent links
    this.resolver.setParents(this.rootContext.id, []);
    this.resolver.setParents(this.mainContext.id, [{ id: this.rootContext.id, priority: 0 }]);
  }

  hasCycle(newNode: GripContextNode): boolean {
    return this.graph.hasCycle(newNode);
  }
  
  submitTask(callback: () => void, priority: number, handleHolder: TaskHandleHolder) {
    this.taskQueue.submit(callback, priority, handleHolder);
  }
  
  submitWeakTask(taskQueueCallback: () => void, handleHolder: TaskHandleHolder) {
    this.taskQueue.submitWeak(taskQueueCallback, 0, handleHolder);
  }

  ensureNode(ctx: GripContext): GripContextNode {
    return this.graph.ensureNode(ctx);
  }

  // Create a new context optionally parented to a given context (defaults to main)
  createContext(parent?: GripContext, priority = 0): GripContext {
    const ctx = new GripContext(this);
    if (parent ?? this.mainContext) ctx.addParent(parent ?? this.mainContext, priority);
    (ctx as any).__grok = this;
    this.ensureNode(ctx);
    // update resolver parents
    const parents = ctx.getParents().map(p => ({ id: p.ctx.id, priority: p.priority }));
    this.resolver.setParents(ctx.id, parents);
    return ctx;
  }

  // Dispose a context: clears caches keyed by this ctx and lets the graph GC remove the node
  disposeContext(ctx: GripContext): void {
    // Optionally: detach from parents to break strong references in contexts
    // There is no public API on GripContext to remove parents; we rely on graph WeakRef GC.
  }

  // Create a home context (optionally parented) and a presentation child context, returning a dual container
  createDualContext(homeParent: GripContext,
    opts?: { destPriority?: number;}
  ): DualContextContainer {
    const home = this.createContext(homeParent, 0);
    // Create presentation child off home
    const dest = home.createChild();
    // Ensure graph and resolver know about dest
    this.ensureNode(dest);
    const parents = dest.getParents().map(p => ({ id: p.ctx.id, priority: p.priority }));
    this.resolver.setParents(dest.id, parents);
    return new DualContextContainer(home, dest);
  }

  registerTap(tap: Tap): void {
    // Default registration at main context
    this.registerTapAt(this.mainContext, tap);
  }

  registerTapAt(ctx: GripContext | GripContextLike, tap: Tap): void {
    const homeCtx = (ctx && (ctx as any).getGripHomeContext) ? (ctx as GripContextLike).getGripHomeContext() : (ctx as GripContext);

    // Index by context
    const set = this.providersByContext.get(homeCtx.id) ?? new Set<Tap>();
    set.add(tap);
    this.providersByContext.set(homeCtx.id, set);
    // Index by tap id
    const ctxSet = this.tapToContexts.get(tap) ?? new Set<string>();
    ctxSet.add(homeCtx.id);
    this.tapToContexts.set(tap, ctxSet);
    // // Ensure producer record at home node and record per provided grip
    // const homeNode = this.graph.ensureNode(homeCtx);
    // const rec = homeNode.getOrCreateProducerRecord(tap, tap.provides);
    // for (const g of tap.provides) {
    //   homeNode.recordProducer(g, rec);
    // }
    
    // Inform resolver for each provided grip
    for (const g of tap.provides) {
      this.resolver.registerLocalProvider(homeCtx.id, g.key);
    }
    this.resolver.propagateAdd(homeCtx.id, new Set(tap.provides.map(g => g.key)));
    // Notify tap
    tap.onAttach!(homeCtx);
  }

  unregisterTap(tap: Tap): void {
    const contexts = Array.from(this.tapToContexts.get(tap) ?? []);
    // Remove from indices and resolver
    for (const ctxId of contexts) {
      const providers = this.providersByContext.get(ctxId);
      if (providers) {
        providers.delete(tap);
        if (providers.size === 0) this.providersByContext.delete(ctxId);
      }
      // propagate removal for all grips provided by this tap
      const homeNode = this.graph.getNodeById(ctxId);
      if (homeNode) {
        const rec = homeNode.producerByTap.get(tap);
        if (rec) {
          const gripKeys = new Set<string>(Array.from(rec.outputs).map(g => g.key));
          if (gripKeys.size > 0) this.resolver.propagateRemove(ctxId, gripKeys);
          // Clear tracked consumers for all destinations for this tap's grips
          for (const dest of rec.getDestinations().values()) {
            for (const g of dest.getGrips()) {
              const node = dest.getContextNode()
              node.unregisterSource(g);
            }
          }
          homeNode.producerByTap.delete(tap);
        }
      }
      // Notify tap(s)
      for (const tap of removed) tap.onDetach?.();
    }
    this.tapToContexts.delete(tap);
    // this.tapDestinations.delete(tapId);
    // Evict any cached drips produced by this tap
    // handled above per destination
  }

  // indexTapDestination removed; use ProducerRecord destinations instead

  // Broadcast new values produced by a tap to all destination contexts currently mapped under a home context
  publish(home: GripContext, tap: Tap, updates: Map<Grip<any>, any>): number {
    const homeNode = this.graph.getNode(home);
    if (!homeNode) return 0;
    const rec = homeNode.producerByTap.get(tap);
    if (!rec) return 0;
    return rec.publish(updates, (destCtx: GripContext, grip: Grip<any>, value: any) => {
      this.graph.notifyConsumers(destCtx, grip as any, value);
    });
  }

  // publishFrom removed: callers must know the home (producer) context

  // Central query API: component asks for a Grip from a Context => gets a Drip<T>
  query<T>(grip: Grip<T>, ctx: GripContext): Drip<T> {
    // Ensure nodes for ctx and all parents encountered
    this.ensureNode(ctx);

    var drip = ctx.getLiveDripForGrip(grip);

    if (drip) { // Best case we have a live drip and it should be resolved to a tap or fallback.
      return drip;
    }

    // Creates a new drip, now we need to resolve it to a tap or fallback.
    drip = ctx.getOrCreateConsumer(grip);

    // If we encounter a root we don't use it unless there were no other options.
    this.resolveConsumer(ctx, ctx, grip);

    return drip;
  }

  resolveConsumer(dest: GripContext, source: GripContext, grip: Grip<any>): void {
    const roots = Array<GripContext>();
    const visited = new Set<GripContext>();
    // See if we can resolve the consumer by looking at parents.
    if(this.resolveConsumerStage1(dest, source, grip, visited, roots)) return;
  
    // If we didn't find a producer in the current context, then we need to
    // check the roots encountered as we treat roots as a last resort.
    var dummyRoots = Array<GripContext>();
    for (const root of roots) {
      if (this.resolveConsumerStage1(dest, root, grip, visited, dummyRoots)) {
        // We found a producer in a root context. We're done.
        return;
      }
    }
    // Didn't find a producer then we need to make sure this is a detached
    // drip.
    this.unresolveConsumer(dest, grip);
  }

  unresolveConsumer(dest: GripContext | GripContextNode, grip: Grip<any>): void {
    const destNode = dest instanceof GripContextNode ? dest : this.ensureNode(dest);
    const resolvedProviders = destNode.getResolvedProviders();
    const providerNode = resolvedProviders.get(grip);
    if (providerNode) {
      providerNode.removeDestinationForContext(grip, destNode);
      resolvedProviders.delete(grip);
    }
  }

  resolveConsumerStage1(
    dest: GripContext, 
    source: GripContext, 
    grip: Grip<any>, 
    visited: Set<GripContext>,
    roots: GripContext[]): boolean {
    // Check to see if the current context has a tap that provides this grip.
    var sourceNode = this.ensureNode(source);
    var producer = sourceNode.get_producers().get(grip);

    if (producer) {
      // We have a tap that provides this grip.
      // We need to resolve the drip to the tap.
      producer.addDestination(sourceNode, grip);
      // // Attach the original destination context as a destination for this producer and grip.
      // producer.addDestinationGrip(this.ensureNode(ctx), grip);
      return true;
    }

    // Check all parents all the way up to the root.
    for (const parent of source.getParents()) {
      const parentCtx = parent.ctx;
      if (parentCtx.isRoot()) {
        roots.push(parentCtx);
        continue;
      }
      if (visited.has(parentCtx)) continue;
      visited.add(parentCtx);
      if (this.resolveConsumerStage1(dest, parentCtx, grip, visited, roots)) return true;
    }

    return false;
  }

  // This is where we resolve a set of produced Grips to potential consumers.
  resolveProducer(ctx: GripContext, current: GripContext | undefined, grips: Set<Grip<any>>) {
    var available_grips = grips;

    // Check to see local consumers first.
    if (current) {
      const node = this.ensureNode(current);
      const producers = node.get_producers();

      // If there are producers that can provide the grips, then these shadow our
      // grips so we remove them from the available grips. If we're completely
      // overridden, then we return. There may have been other contexts that where
      // we successfully resolved or there may be more grips being registered later
      // where the source context can provide data for.
      if (producers.size > 0) {
        const common = intersection(available_grips, producers.keys());
        if (common.size > 0) {
          available_grips = difference(available_grips, common);
          if (available_grips.size === 0) {
            // The available grips are completely overridden by other producers.
            return;
          }
        }
      }
    } else {
      // On the first call in the recursion we set the current context to be undefined.
      // as we don't want to shadow ourselves. In this case we do want to prodice for
      // local consumers.
      current = ctx;
    }

    // This is where we check for consumers in the "current" destination context.
    const node = this.ensureNode(current);
    // Now scan the children to find any consumers that can be provided by the producers context.
    const consumers = node.get_consumers();
    for (const [grip, drip] of consumers) {
      if (available_grips.has(grip)) {
        // OK - we have a consumer that we want to provide.
        // Now we need to check to see if this context/grip pair is already
        // has a different visible producer by doing a resolveConsumer.
        ?????
      }
    }
  }


  // Expose read-only snapshot of the graph for debugging/inspection
  getGraph(): ReadonlyMap<string, GripContextNode> {
    return this.graph.snapshot();
  }
}
