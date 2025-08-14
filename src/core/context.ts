import { Grip } from "./grip";
import { Drip } from "./drip";
import type { Tap } from "./tap";
import { GripContextNode } from "./graph";
import { Grok } from "./grok";
import { TaskHandleHolder } from "./task_queue";

// A context can inherit from multiple parents with priorities.
// It can hold overrides as either values OR Drips (dynamic params).
type Override = { type: "value"; value: unknown } | { type: "drip"; drip: Drip<any> };

export class GripContext {
  private grok: Grok;
  // Keep hard references to parents.
  private parents: Array<{ ctx: GripContext; priority: number }> = [];
  private contextNode: GripContextNode;
  readonly id: string;
  private handleHolder = new TaskHandleHolder();

  constructor(engine: Grok, id?: string) {
    this.grok = engine;
    this.id = id ?? `ctx_${Math.random().toString(36).slice(2)}`;
    this.contextNode = engine.ensureNode(this);
  }

  getGrok(): Grok {
    return this.grok;
  }

  isRoot(): boolean {
    // Root is the context that has no parents.
    return this.parents.length === 0;
  }

  submitTask(callback: () => void, priority = 0): void {
    this.contextNode.submitTask(callback, priority);
  }
  
  submitWeakTask(taskQueueCallback: () => void) {
    this.contextNode.submitWeakTask(taskQueueCallback);
  }

  // Expose a shallow copy of parents (for graph building / debug)
  getParents(): ReadonlyArray<{ ctx: GripContext; priority: number }> {
    return this.parents.slice();
  }

  addParent(parent: GripContext, priority = 0): this {
    if (parent.contextNode.grok !== this.grok) throw new Error("Contexts must be attached to the same engine");
    if (parent === this) throw new Error("Context cannot be its own parent");

    const parent_ref = { ctx: parent, priority };
    this.parents.push(parent_ref);
    this.parents.sort((a, b) => b.priority - a.priority);

    if (this.grok.hasCycle(this.contextNode)) {
      // Remmove the node we just added so bad things don't happen if we continue.
      this.parents = this.parents.filter(p => p !== parent_ref);
      throw new Error("Cycle detected in context DAG");
    }

    return this;
  }

  private hasAncestor(target: GripContext): boolean {
    return this.parents.some(
      p => p.ctx === target || p.ctx.hasAncestor(target)
    );
  }

  // Direct overrides are deprecated in taps-only design
  setValue<T>(_grip: Grip<T>, _value: T): this { return this; }
  setDrip<T>(_grip: Grip<T>, _drip: Drip<T>): this { return this; }

  // Resolve a parameter (value or drip) following priority across parents
  resolveOverride<T>(_grip: Grip<T>): Override | undefined { return undefined; }
  resolveOverrideWithSource<T>(_grip: Grip<T>): { override: Override; source: GripContext } | undefined { return undefined; }

	// Create a child context
	createChild(id?: string): GripContext {
		const child = new GripContext(id).addParent(this, 0);
		// Link new child to the same engine as parent (for tap lifecycle & publishing)
		(child as any).__grok = (this as any).__grok;
		return child;
	}

  getLiveDripForGrip<T>(grip: Grip<T>): Drip<T> | undefined {
    return this.contextNode.getLiveDripForGrip(grip);
  }

  getOrCreateConsumer<T>(grip: Grip<T>): Drip<T> {
    return this.contextNode.getOrCreateConsumer(grip);
  }

	// --- App-facing helpers to manage taps without referencing the engine ---
	registerTap(tap: Tap): void {
		const grok = (this as any).__grokRef?.deref?.() ?? (this as any).__grok;
		if (!grok) throw new Error("Context is not attached to an engine");
		grok.registerTapAt(this, tap);
	}

	unregisterTap(tap: Tap): void {
		const grok = (this as any).__grokRef?.deref?.() ?? (this as any).__grok;
		if (!grok) return;
		grok.unregisterTap(tap);
	}

  unregisterSource(grip: Grip<any>): void {
    const node = this.contextNode;
    node.unregisterSource(grip);
  }

  _getContextNode() {
    return this.contextNode;
  }
}
