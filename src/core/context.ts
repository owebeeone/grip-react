import { Grip } from "./grip";
import { Drip } from "./drip";
import type { Tap } from "./tap";
import { GripContextNode } from "./graph";
import { Grok } from "./grok";

// A context can inherit from multiple parents with priorities.
// It can hold overrides as either values OR Drips (dynamic params).
type Override = { type: "value"; value: unknown } | { type: "drip"; drip: Drip<any> };

export class GripContext {
  readonly kind: "GripContext" = "GripContext";
  private grok: Grok;
  private contextNode: GripContextNode;
  readonly id: string;

  constructor(engine: Grok, id?: string) {
    this.grok = engine;
    this.id = id ?? `ctx_${Math.random().toString(36).slice(2)}`;
    //console.log(`GripContext: Created new context with ID: ${this.id}`);
    this.contextNode = engine.ensureNode(this);
  }

  getNode(): GripContextNode {
    return this.contextNode;
  }

  getGrok(): Grok {
    return this.grok;
  }

  isRoot(): boolean {
    // Root is the context that has no parents.
    return this.contextNode.get_parent_nodes().length === 0;
  }

  submitTask(callback: () => void, priority = 0): void {
    this.contextNode.submitTask(callback, priority);
  }
  
  submitWeakTask(taskQueueCallback: () => void) {
    this.contextNode.submitWeakTask(taskQueueCallback);
  }

  // Expose a shallow copy of parents (for graph building / debug)
  getParents(): ReadonlyArray<{ ctx: GripContext; priority: number }> {
    // Guard against contextNode not being initialized yet
    if (!this.contextNode) {
      return [];
    }
    return this.contextNode.get_parents_with_priority().map(p => ({
      ctx: p.node.get_context()!,
      priority: p.priority
    })).filter(p => p.ctx != null);
  }

  addParent(parent: GripContext, priority = 0): this {
    if (parent.contextNode.grok !== this.grok) throw new Error("Contexts must be attached to the same engine");
    if (parent === this) throw new Error("Context cannot be its own parent");

    // All parent management is now done in GripContextNode
    this.contextNode.addParent(parent.contextNode, priority);

    if (this.grok.hasCycle(this.contextNode)) {
      // Remove the node we just added so bad things don't happen if we continue.
      this.contextNode.removeParent(parent.contextNode);
      throw new Error("Cycle detected in context DAG");
    }

    return this;
  }

  unlinkParent(parent: GripContext): this {
    // All parent management is now done in GripContextNode
    try {
      this.contextNode.removeParent(parent.contextNode);
    } catch (e) {
      // Parent not found - ignore
    }
    return this;
  }

  private hasAncestor(target: GripContext): boolean {
    return this.contextNode.get_parent_nodes().some(
      p => p.get_context() === target || p.get_context()?.hasAncestor(target) || false
    );
  }

  // Direct overrides are deprecated in taps-only design
  setValue<T>(_grip: Grip<T>, _value: T): this { return this; }
  setDrip<T>(_grip: Grip<T>, _drip: Drip<T>): this { return this; }

  // Resolve a parameter (value or drip) following priority across parents
  resolveOverride<T>(_grip: Grip<T>): Override | undefined { return undefined; }
  resolveOverrideWithSource<T>(_grip: Grip<T>): { override: Override; source: GripContext } | undefined { return undefined; }

	// Create a child context
	createChild(opts?: { priority?: number}): GripContext {
		const child = new GripContext(this.grok).addParent(this, opts?.priority ?? 0);
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
		if (!this.grok) throw new Error("Context is not attached to an engine");
		this.grok.registerTapAt(this, tap);
	}

	unregisterTap(tap: Tap): void {
		this.grok.unregisterTap(tap);
	}

  unregisterSource(grip: Grip<any>): void {
    const node = this.contextNode;
    node.unregisterSource(grip);
  }

  _getContextNode() {
    return this.contextNode;
  }

  getContextNode() {
    return this.contextNode;
  }
}
