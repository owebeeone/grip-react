import { Grip } from "./grip";
import { Drip } from "./drip";

// A context can inherit from multiple parents with priorities.
// It can hold overrides as either values OR Drips (dynamic params).
type Override = { type: "value"; value: unknown } | { type: "drip"; drip: Drip<any> };

export class GripContext {
  private parents: Array<{ ctx: GripContext; priority: number }> = [];
  private overrides = new Map<string, Override>();
  private producerDrips = new Map<string, Set<Drip<any>>>();
  private consumerDrips = new Map<string, Set<Drip<any>>>();
  private overrideListeners?: Map<string, Set<() => void>>;
  readonly id: string;

  constructor(id?: string) {
    this.id = id ?? `ctx_${Math.random().toString(36).slice(2)}`;
  }

  // Expose a shallow copy of parents (for graph building / debug)
  getParents(): ReadonlyArray<{ ctx: GripContext; priority: number }> {
    return this.parents.slice();
  }

  addParent(parent: GripContext, priority = 0): this {
    if (parent === this) throw new Error("Context cannot be its own parent");
    // Simple cycle guard:
    if (parent.hasAncestor(this)) throw new Error("Cycle detected in context DAG");
    this.parents.push({ ctx: parent, priority });
    this.parents.sort((a, b) => b.priority - a.priority);
    return this;
  }

  private hasAncestor(target: GripContext): boolean {
    return this.parents.some(
      p => p.ctx === target || p.ctx.hasAncestor(target)
    );
  }

  setValue<T>(grip: Grip<T>, value: T): this {
    this.overrides.set(grip.key, { type: "value", value });
    this.notifyOverrideChange(grip.key);
    return this;
  }

  setDrip<T>(grip: Grip<T>, drip: Drip<T>): this {
    this.overrides.set(grip.key, { type: "drip", drip });
    this.notifyOverrideChange(grip.key);
    return this;
  }

  // Resolve a parameter (value or drip) following priority across parents
  resolveOverride<T>(grip: Grip<T>): Override | undefined {
    const o = this.overrides.get(grip.key);
    if (o) return o as Override;
    for (const { ctx } of this.parents) {
      const found = ctx.resolveOverride(grip);
      if (found) return found as Override;
    }
    return undefined;
  }

  // Like resolveOverride, but also returns the context that supplied it
  resolveOverrideWithSource<T>(grip: Grip<T>): { override: Override; source: GripContext } | undefined {
    const o = this.overrides.get(grip.key);
    if (o) return { override: o as Override, source: this };
    for (const { ctx } of this.parents) {
      const found = ctx.resolveOverrideWithSource(grip);
      if (found) return found as { override: Override; source: GripContext };
    }
    return undefined;
  }

  // Create a child context with optional initial overrides
  createChild(id?: string, init?: Array<{ grip: Grip<any>, value?: any, drip?: Drip<any> }>): GripContext {
    const child = new GripContext(id).addParent(this, 0);
    init?.forEach(({ grip, value, drip }) => {
      if (drip) child.setDrip(grip as any, drip);
      else child.setValue(grip as any, value);
    });
    return child;
  }

  // --- Producer/Consumer child management (drips) ---
  addProducerDrip<T>(grip: Grip<T>, drip: Drip<T>): void {
    const set = this.producerDrips.get(grip.key) ?? new Set<Drip<any>>();
    set.add(drip as unknown as Drip<any>);
    this.producerDrips.set(grip.key, set);
  }

  addConsumerDrip<T>(grip: Grip<T>, drip: Drip<T>): void {
    const set = this.consumerDrips.get(grip.key) ?? new Set<Drip<any>>();
    set.add(drip as unknown as Drip<any>);
    this.consumerDrips.set(grip.key, set);
  }

  getProducerDrips(grip?: Grip<any>): ReadonlyMap<string, ReadonlySet<Drip<any>>> | ReadonlySet<Drip<any>> | undefined {
    if (!grip) return this.producerDrips as unknown as ReadonlyMap<string, ReadonlySet<Drip<any>>>;
    return this.producerDrips.get(grip.key);
  }

  getConsumerDrips(grip?: Grip<any>): ReadonlyMap<string, ReadonlySet<Drip<any>>> | ReadonlySet<Drip<any>> | undefined {
    if (!grip) return this.consumerDrips as unknown as ReadonlyMap<string, ReadonlySet<Drip<any>>>;
    return this.consumerDrips.get(grip.key);
  }

  // Subscribe to local override changes for a specific grip
  onOverrideChange<T>(grip: Grip<T>, fn: () => void): () => void {
    const key = grip.key;
    if (!this.overrideListeners) this.overrideListeners = new Map();
    const existing = this.overrideListeners.get(key) ?? new Set<() => void>();
    existing.add(fn);
    this.overrideListeners.set(key, existing);
    return () => {
      const s = this.overrideListeners?.get(key);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) this.overrideListeners?.delete(key);
    };
  }

  private notifyOverrideChange(key: string): void {
    const set = this.overrideListeners?.get(key);
    if (set) set.forEach(cb => cb());
  }
}
