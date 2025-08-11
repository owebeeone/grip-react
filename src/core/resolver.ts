// Simple, engine-independent resolver for TDD of DAG mapping logic.
// Operates on string ids for contexts and string keys for grips.

export type ContextId = string;
export type GripKey = string;

type ParentLink = { id: ContextId; priority: number };

export class SimpleResolver {
  private parents = new Map<ContextId, ParentLink[]>();
  private children = new Map<ContextId, Set<ContextId>>();
  private localProviders = new Map<ContextId, Set<GripKey>>();
  private resolvedMap = new Map<ContextId, Map<GripKey, ContextId>>();

  setParents(ctx: ContextId, parents: ParentLink[]): void {
    // store parents sorted by priority (desc)
    const sorted = parents.slice().sort((a, b) => b.priority - a.priority);
    this.parents.set(ctx, sorted);
    // update children adjacency
    for (const p of sorted) {
      const set = this.children.get(p.id) ?? new Set<ContextId>();
      set.add(ctx);
      this.children.set(p.id, set);
    }
  }

  registerLocalProvider(ctx: ContextId, grip: GripKey): void {
    const set = this.localProviders.get(ctx) ?? new Set<GripKey>();
    if (set.has(grip)) return; // idempotent
    set.add(grip);
    this.localProviders.set(ctx, set);
  }

  hasLocalProvider(ctx: ContextId, grip: GripKey): boolean {
    return this.localProviders.get(ctx)?.has(grip) ?? false;
  }

  getResolvedProvider(ctx: ContextId, grip: GripKey): ContextId | undefined {
    return this.resolvedMap.get(ctx)?.get(grip);
  }

  private setResolvedProvider(ctx: ContextId, grip: GripKey, provider: ContextId): void {
    const m = this.resolvedMap.get(ctx) ?? new Map<GripKey, ContextId>();
    m.set(grip, provider);
    this.resolvedMap.set(ctx, m);
  }

  // Upward resolution: closest provider wins (check local, then parents by priority depth-first)
  resolveUpward(ctx: ContextId, grip: GripKey, suppressed?: Map<ContextId, Set<GripKey>>): ContextId | undefined {
    // 1) local
    const isSuppressed = suppressed?.get(ctx)?.has(grip) ?? false;
    if (!isSuppressed && this.hasLocalProvider(ctx, grip)) {
      this.setResolvedProvider(ctx, grip, ctx);
      return ctx;
    }
    // 2) parents
    const parents = this.parents.get(ctx) ?? [];
    for (const p of parents) {
      const found = this.resolveUpward(p.id, grip, suppressed);
      if (found) {
        this.setResolvedProvider(ctx, grip, found);
        return found;
      }
    }
    // 3) not found
    return undefined;
  }

  // Add tap at providerCtx for a set of grips: update resolved mappings for descendants where this provider is the closest
  propagateAdd(providerCtx: ContextId, grips: ReadonlySet<GripKey>): void {
    const start = providerCtx;
    // DFS
    const visited = new Map<ContextId, string>();
    const gripSig = (s: ReadonlySet<GripKey>) => Array.from(s).sort().join('|');
    const dfs = (node: ContextId, available: ReadonlySet<GripKey>) => {
      const sig = gripSig(available);
      const prev = visited.get(node);
      if (prev === sig) return; // already visited with same available set
      visited.set(node, sig);

      // For all available grips, resolve and set mapping (may select a closer provider due to overshadowing)
      for (const g of available) {
        const chosen = this.resolveUpward(node, g);
        if (chosen) this.setResolvedProvider(node, g, chosen);
      }

      // Descend
      const kids = this.children.get(node);
      if (!kids) return;
      for (const child of kids) dfs(child, available);
    };

    dfs(start, new Set(grips));
  }

  // Remove tap at providerCtx for a set of grips: clear mappings that pointed to it, and re-resolve
  propagateRemove(providerCtx: ContextId, grips: ReadonlySet<GripKey>): void {
    const start = providerCtx;
    const visited = new Map<ContextId, string>();
    const gripSig = (s: ReadonlySet<GripKey>) => Array.from(s).sort().join('|');
    const suppressed = new Map<ContextId, Set<GripKey>>([[providerCtx, new Set(grips)]]);
    const dfs = (node: ContextId, candidate: ReadonlySet<GripKey>) => {
      const sig = gripSig(candidate);
      const prev = visited.get(node);
      if (prev === sig) return;
      visited.set(node, sig);

      // If local providers overshadow (except at providerCtx), remove those grips from candidate for subtree
      const locals = node === providerCtx ? new Set<GripKey>() : (this.localProviders.get(node) ?? new Set<GripKey>());
      const nextCand = new Set<GripKey>();
      for (const g of candidate) {
        if (!locals.has(g)) nextCand.add(g);
      }
      if (nextCand.size === 0) return;

      // For any mapping that pointed to providerCtx, clear and re-resolve
      const m = this.resolvedMap.get(node);
      if (m) {
        for (const g of Array.from(nextCand)) {
          if (m.get(g) === providerCtx) {
            m.delete(g);
            const repl = this.resolveUpward(node, g, suppressed);
            if (repl) this.setResolvedProvider(node, g, repl);
          }
        }
      }

      const kids = this.children.get(node);
      if (!kids) return;
      for (const child of kids) dfs(child, nextCand);
    };

    dfs(start, new Set(grips));
  }
}


