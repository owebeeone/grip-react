import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip, Unsubscribe } from "./drip";
import type { Tap } from "./tap";
import { Grok } from "./grok";
import { GripContextNodeIf } from "./context_node";
import { TaskHandleHolder } from "./task_queue";

export class ProducerRecord {
  readonly tap: Tap;
  // Map of destination context id -> Destination (which holds the grips for that dest)
  private destinations = new Map<GripContextNode, Destination>();

  // Optional: outputs this tap can produce (for convenience)
  readonly outputs = new Set<Grip<any>>();

  constructor(tap: Tap, outputs?: Iterable<Grip<any>>) {
    this.tap = tap;
    if (outputs) for (const g of outputs) this.outputs.add(g as unknown as Grip<any>);
  }

  addDestinationGrip(destNode: GripContextNode, grip: Grip<any>): void {
    var existing = this.destinations.get(destNode);
    var added = false;
    if (!existing) {
      existing = new Destination(destNode, this.tap, this);
      this.destinations.set(destNode, existing);
      added = true;
      // Register any per-destination parameter subscriptions
      existing.registerDestinationParamDrips();
    }
    existing.addGrip(grip);
    if (added) {
      this.tap.onConnect?.(destNode.get_context() as GripContext, grip);
    }
  }

  removeDestinationForContext(destCtx: GripContextNode): void {
    this.destinations.delete(destCtx);
    if (this.destinations.size === 0) {
      this.tap.onDetach?.();
    }
  }

  getDestinations(): Map<GripContextNode, Destination> { return this.destinations; }

  // Add a destination for a grip.
  addDestination(destNode: GripContextNode, grip: Grip<any>): void {
    var existing = this.destinations.get(destNode);
    if (!existing) {
      existing = new Destination(destNode, this.tap, this);
      this.destinations.set(destNode, existing);
      // Register any per-destination parameter subscriptions
      existing.registerDestinationParamDrips();
    }
    existing.addGrip(grip);
  }

  // Remove the context/grip pair from this producer.
  removeDestinationGripForContext(destNode: GripContextNode, grip: Grip<any>): void {
    const destination = this.destinations.get(destNode);
    if (destination) {
      destination.removeGrip(grip);
      if (destination.getGrips().size === 0) {
        this.removeDestinationForContext(destNode);
      }
    }
  }

  /**
   * Publish values to the targets of this producer.
   * 
   * Each destination is updated with the values that are present in the values map
   * and only for the grips that the destination is subscribed to.
   * 
   * If a destination context is gone, it is removed from the map.
   */
  publish(
      values: Map<Grip<any>, any>, 
      updater: (destCtx: GripContext, grip: Grip<any>, value: any) => void): number {
    let count = 0;
    const destCtxsToRemove = new Set<GripContextNode>();
    try {
      for (const [destNode, destination] of this.getDestinations()) {
        const destCtx = destNode.get_context();
        if (!destCtx) {
          // Context is gone, remove the destination, stash these in a set
          // so we can remove them after the loop so we don't mess up the iterator.
          destCtxsToRemove.add(destNode);
          continue;
        }
        // We only update the destination for the grips the destination is subscribed to.
        for (const g of destination.getGrips()) {
          if (values.has(g)) {
            updater(destCtx, g, values.get(g));
            count += 1;
          }
        }
      }
    } finally {
      for (const destNode of destCtxsToRemove) {
        this.removeDestinationForContext(destNode);
      }
    }
    return count;
  }
}

// Destination caches the visibility state for a provider at a destination context
// as well as manages any destination param drips that are needed for the provider.
export class Destination {
  private readonly destContextNode: GripContextNode;
  private readonly grips: Set<Grip<any>>;
  private readonly tap: Tap;
  private readonly producer: ProducerRecord;

  // This stores the destination param drips for this destination.
  private readonly destinationParamDrips: Map<Grip<any>, Drip<any>> = new Map();
  private readonly destinationDripsSubs: Map<Grip<any>, Unsubscribe> = new Map();

  /**
   * destContextNode is The destination context node that this Destination is for.
   * tap is the tap that is providing the grips to this destination.
   * producer is the producer record that is providing the grips to this destination.
   * grips is the set of grips that are being provided to this destination. Note that
   * each destination may only have a subset of the grips that the provider provides
   * because some grips may be shadowed by a different tap.
   */
  constructor(destContextNode: GripContextNode, tap: Tap, producer: ProducerRecord, grips?: Iterable<Grip<any>>, ) {
    this.destContextNode = destContextNode;
    this.tap = tap;
    this.grips = new Set(grips ?? []);
    this.producer = producer;
  }

  /**
   * Register for destination params.
   */
  registerDestinationParamDrips() {
    if (!this.tap.destinationParamGrips) return;
    const self = this;
    for (const grip of this.tap.destinationParamGrips) {
      const drip = this.destContextNode.getOrCreateConsumer(grip);
      this.destinationParamDrips.set(grip, drip);
      this.destinationDripsSubs.set(grip, drip.subscribePriority((v) => {
        // The produceOnDestParams should exist, let's throw if it doesn't.
        self.tap.produceOnDestParams!(this.destContextNode.get_context(), grip);
      }));
    }
  }

  /**
   * Unregister for destination params.
   */
  unregisterDestination() {
    for (const [grip, sub] of this.destinationDripsSubs) {
      sub();
    }
    this.destinationDripsSubs.clear();
    this.destinationParamDrips.clear();
    this.producer.removeDestinationForContext(this.destContextNode);
  }

  /**
   * Add a destination grip for this destination.
   */
  addGrip(g: Grip<any>) { 
    if (this.grips.has(g)) return;
    if (this.grips.size === 0) {
      // Register for destination params on the first destination grip added.
      this.registerDestinationParamDrips();
    }
    this.grips.add(g); 
  }

  /**
   * Removes a destination grip for this destination.
   */
  removeGrip(g: Grip<any>) {
    if (!this.grips.has(g)) return;
    this.grips.delete(g); 
    if (this.grips.size === 0) {
      // Unregister for destination params if this is the last destination grip removed.
      this.unregisterDestination();
    }
  }

  /**
   * Get the grips being delivered for this destination.
   */
  getGrips(): ReadonlySet<Grip<any>> {
    return this.grips;
  }

  getContext(): GripContext | undefined { 
    return this.destContextNode.contextRef.deref(); 
  }
  
  getContextNode() {
    return this.destContextNode
  }
}

export class GripContextNode implements GripContextNodeIf {
  readonly grok: Grok;
  readonly id: string;
  readonly contextRef: WeakRef<GripContext>;
  readonly parents: GripContextNode[] = [];
  readonly children: GripContextNode[] = [];
  readonly handleHolder = new TaskHandleHolder();

  // One producer per Grip key - ProducerRecords cache the state of the
  // producer graph.
  readonly producers = new Map<Grip<any>, ProducerRecord>();
  // One weakly-referenced drip per Grip at this destination context
  readonly consumers = new Map<Grip<any>, WeakRef<Drip<any>>>();
  // Destination-side resolved map: which provider context id supplies each Grip
  readonly resolvedProviders = new Map<Grip<any>, GripContextNode>();
  // Source-side: producer records per tap instance
  readonly producerByTap = new Map<Tap, ProducerRecord>();
  private lastSeen = Date.now();

  constructor(grok: Grok, ctx: GripContext) {
    this.grok = grok;
    this.id = ctx.id;
    this.contextRef = new WeakRef(ctx);
  }

  get_grok(): Grok {
    return this.grok;
  }
  
  submitTask(callback: () => void, priority: number) {
    this.grok.submitTask(callback, priority, this.handleHolder);
  }

  submitWeakTask(taskQueueCallback: () => void) {
    this.grok.submitWeakTask(taskQueueCallback, this.handleHolder);
  }

  get_context(): GripContext | undefined {
    return this.contextRef.deref();
  }

  get_parent_nodes(): GripContextNode[] {
    return this.parents;
  }

  get_producers(): Map<Grip<any>, ProducerRecord> {
    return this.producers;
  }

  get_consumers(): Map<Grip<any>, WeakRef<Drip<any>>> {
    return this.consumers;
  }

  get_children_nodes(): GripContextNode[] {
    return this.children;
  }

  addParent(parent: GripContextNode): void {
    if (!this.parents.includes(parent)) {
      this.parents.push(parent);
      parent.children.push(this);
    }
  }

  recordProducer<T>(grip: Grip<T>, rec: ProducerRecord): void {
    this.producers.set(grip as unknown as Grip<any>, rec);
    this.lastSeen = Date.now();
  }

  getResolvedProviders(): Map<Grip<any>, GripContextNode> {
    return this.resolvedProviders;
  }

  setResolvedProvider<T>(grip: Grip<T>, node: GripContextNode): void {
    this.resolvedProviders.set(grip as unknown as Grip<any>, node);
  }

  getOrCreateProducerRecord(tap: Tap, outputs?: Iterable<Grip<any>>): ProducerRecord {
    let rec = this.producerByTap.get(tap);
    if (!rec) {
      rec = new ProducerRecord(tap, outputs);
      this.producerByTap.set(tap, rec);
    }
    return rec;
  }

  getProducerRecord(tap: Tap): ProducerRecord | undefined {
    return this.producerByTap.get(tap);
  }

  recordConsumer<T>(grip: Grip<T>, drip: Drip<T>): void {
    this.consumers.set(grip as unknown as Grip<any>, new WeakRef(drip as unknown as Drip<any>));
    this.lastSeen = Date.now();
  }

  getOrCreateConsumer<T>(grip: Grip<T>): Drip<T> {
    let drip = this.consumers.get(grip as unknown as Grip<any>)?.deref();
    if (!drip) {
      const ctx = this.get_context() as GripContext;
      if (!ctx) throw new Error("Context is gone"); // This should never happen.
      drip = new Drip<T>(ctx, grip.defaultValue as unknown as T | undefined);
      this.recordConsumer(grip, drip);
      drip.addOnZeroSubscribers(() => {
        this.removeConsumerForGrip(grip);
      });
    }
    return drip;
  }

  // Returns the live drip instance for this grip at this destination context, if any
  getLiveDripForGrip<T>(grip: Grip<T>): Drip<T> | undefined {
    const wr = this.consumers.get(grip as unknown as Grip<any>);
    const d = wr?.deref();
    if (!d && wr) this.consumers.delete(grip as unknown as Grip<any>);
    return d as unknown as Drip<T> | undefined;
  }

  // Notify the live consumer drip for a grip at this destination context
  notifyConsumers<T>(grip: Grip<T>, value: T): number {
    const d = this.getLiveDripForGrip(grip);
    if (!d) return 0;
    d.next(value);
    return 1;
  }

  // Remove the drip for this grip.
  removeConsumerForGrip<T>(grip: Grip<T>): void {
    this.consumers.delete(grip as unknown as Grip<any>);
    this.unregisterSource(grip);
  }

  // If we have a producer configured for this grip, unregister ourselves from it.
  unregisterSource(grip: Grip<any>) {
    const node = this.resolvedProviders.get(grip);
    if (node) {
      node.removeDestinationForContext(grip, this);
    }
  }

  // If this context has a destination for this grip, remove that grip as a destination.
  removeDestinationForContext(grip: Grip<any>, dest: GripContextNode): void {
    const producer = this.producers.get(grip);
    if (producer) {
      producer.removeDestinationGripForContext(dest, grip);
    }
  }

  touch(): void { this.lastSeen = Date.now(); }
  getLastSeen(): number { return this.lastSeen; }
}

export class GrokGraph {
  private grok: Grok;
  private nodes = new Map<string, GripContextNode>();
  private gcIntervalMs = 30000;
  private maxIdleMs = 120000;
  private gcTimer: any | null = null;

  constructor(grok: Grok) {
    this.grok = grok;
  }

  // Check for cycles in the graph from the new node.
  hasCycle(newNode: GripContextNode): boolean {
    const todo = new Set<GripContextNode>(newNode.get_children_nodes());
    const seen = new Set<GripContextNode>();
    const stack = new Array<GripContextNode>();
    const visit = (node: GripContextNode) => {
      todo.delete(node);
      if (seen.has(node)) return false;
      seen.add(node);
      stack.push(node);
      for (const parent of node.get_parent_nodes()) {
        if (stack.includes(parent)) return true;
        if (visit(parent)) return true;
      }
      stack.pop();
      return false;
    };
    while (todo.size > 0) {
      const node = todo.values().next().value;
      if (!node) continue; // Should never happen.
      if (visit(node)) return true;
    }
    return false;
  }

  ensureNode(ctx: GripContext): GripContextNode {
    let node = this.nodes.get(ctx.id);
    if (!node) {
      node = new GripContextNode(this.grok, ctx);
      this.nodes.set(ctx.id, node);
      // Connect parents hard
      for (const { ctx: parentCtx } of ctx.getParents()) {
        const parentNode = this.ensureNode(parentCtx);
        node.addParent(parentNode);
      }
      this.startGcIfNeeded();
    }
    node.touch();
    return node;
  }

  getNode(ctx: GripContext): GripContextNode | undefined {
    return this.nodes.get(ctx.id);
  }

  getNodeById(id: string): GripContextNode | undefined {
    return this.nodes.get(id);
  }

  snapshot(): ReadonlyMap<string, GripContextNode> {
    return this.nodes;
  }

  // Notify all live consumers for a grip in a destination context
  notifyConsumers<T>(destCtx: GripContext, grip: Grip<T>, value: T): number {
    const node = this.getNode(destCtx);
    if (!node) return 0;
    return node.notifyConsumers(grip, value);
  }

  private startGcIfNeeded() {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => this.gcSweep(), this.gcIntervalMs);
    // Avoid keeping the process alive due to GC timer
    try { (this.gcTimer as any).unref?.(); } catch {}
  }

  private gcSweep() {
    const now = Date.now();
    for (const [id, node] of this.nodes) {
      const ctx = node.contextRef.deref();
      const contextGone = !ctx;
      const idleTooLong = now - node.getLastSeen() > this.maxIdleMs;
      const noConsumers = this.countLiveConsumers(node) === 0;

      if (contextGone && noConsumers) {
        this.nodes.delete(id);
        continue;
      }

      if (idleTooLong && noConsumers && contextGone) {
        this.nodes.delete(id);
      }
    }
  }

  private countLiveConsumers(node: GripContextNode): number {
    let count = 0;
    for (const wr of node.consumers.values()) {
      if (wr.deref()) count += 1;
    }
    return count;
  }

}


