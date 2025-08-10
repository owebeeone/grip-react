import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip } from "./drip";

export type ProducerRecord =
  | { type: "tap"; tapId: string; drip?: Drip<any>; value?: never }
  | { type: "override-value"; tapId?: never; value: unknown }
  | { type: "override-drip"; tapId?: never; drip: Drip<any> };

export class GripContextNode {
  readonly id: string;
  readonly contextRef: WeakRef<GripContext>;
  readonly parents: GripContextNode[] = [];
  // One producer per Grip key
  readonly producers = new Map<Grip<any>, ProducerRecord>();
  // Weakly track drips per Grip
  readonly consumers = new Map<Grip<any>, Set<WeakRef<Drip<any>>>>();

  constructor(ctx: GripContext) {
    this.id = ctx.id;
    this.contextRef = new WeakRef(ctx);
  }

  addParent(parent: GripContextNode): void {
    if (!this.parents.includes(parent)) this.parents.push(parent);
  }

  recordProducer<T>(grip: Grip<T>, rec: ProducerRecord): void {
    this.producers.set(grip as unknown as Grip<any>, rec);
  }

  recordConsumer<T>(grip: Grip<T>, drip: Drip<T>): void {
    const set = this.consumers.get(grip as unknown as Grip<any>) ?? new Set<WeakRef<Drip<any>>>();
    set.add(new WeakRef(drip as unknown as Drip<any>));
    this.consumers.set(grip as unknown as Grip<any>, set);
  }
}

export class GrokGraph {
  private nodes = new Map<string, GripContextNode>();

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
    }
    return node;
  }

  getNode(ctx: GripContext): GripContextNode | undefined {
    return this.nodes.get(ctx.id);
  }

  snapshot(): ReadonlyMap<string, GripContextNode> {
    return this.nodes;
  }
}


