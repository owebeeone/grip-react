import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip } from "./drip";

export type ProducerRecord =
  | { type: "tap"; tapId: string; drip?: Drip<any>; value?: never; outputs?: Map<Grip<any>, Drip<any>> }
  | { type: "override-value"; tapId?: never; value: unknown; outputs?: Map<Grip<any>, Drip<any>> }
  | { type: "override-drip"; tapId?: never; drip: Drip<any>; outputs?: Map<Grip<any>, Drip<any>> };

export class GripContextNode {
  readonly id: string;
  readonly contextRef: WeakRef<GripContext>;
  readonly parents: GripContextNode[] = [];
  // One producer per Grip key
  readonly producers = new Map<Grip<any>, ProducerRecord>();
  // Weakly track drips per Grip
  readonly consumers = new Map<Grip<any>, Set<WeakRef<Drip<any>>>>();
  private lastSeen = Date.now();

  constructor(ctx: GripContext) {
    this.id = ctx.id;
    this.contextRef = new WeakRef(ctx);
  }

  addParent(parent: GripContextNode): void {
    if (!this.parents.includes(parent)) this.parents.push(parent);
  }

  recordProducer<T>(grip: Grip<T>, rec: ProducerRecord): void {
    this.producers.set(grip as unknown as Grip<any>, rec);
    this.lastSeen = Date.now();
  }

  recordConsumer<T>(grip: Grip<T>, drip: Drip<T>): void {
    const set = this.consumers.get(grip as unknown as Grip<any>) ?? new Set<WeakRef<Drip<any>>>();
    set.add(new WeakRef(drip as unknown as Drip<any>));
    this.consumers.set(grip as unknown as Grip<any>, set);
    this.lastSeen = Date.now();
  }

  touch(): void { this.lastSeen = Date.now(); }
  getLastSeen(): number { return this.lastSeen; }
}

export class GrokGraph {
  private nodes = new Map<string, GripContextNode>();
  private gcIntervalMs = 30000;
  private maxIdleMs = 120000;
  private gcTimer: any | null = null;

  ensureNode(ctx: GripContext): GripContextNode {
    let node = this.nodes.get(ctx.id);
    if (!node) {
      node = new GripContextNode(ctx);
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

  snapshot(): ReadonlyMap<string, GripContextNode> {
    return this.nodes;
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
    for (const set of node.consumers.values()) {
      for (const wr of set) {
        if (wr.deref()) count += 1;
      }
    }
    return count;
  }
}


