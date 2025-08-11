import { describe, it, expect } from 'vitest';
import { SimpleResolver } from '../src/core/resolver';

// Resolver/DAG behavior test plan (TDD skeleton)

describe('Resolver mapping (context, grip) → provider context', () => {
  it('resolves to closest provider in parent chain; undefined when none', () => {
    const r = new SimpleResolver();
    // Graph: root <- A <- B
    r.setParents('A', [{ id: 'root', priority: 0 }]);
    r.setParents('B', [{ id: 'A', priority: 0 }]);
    // only root provides G
    r.registerLocalProvider('root', 'G');
    expect(r.resolveUpward('B', 'G')).toBe('root');
    expect(r.getResolvedProvider('B', 'G')).toBe('root');
    expect(r.getResolvedProvider('A', 'G')).toBe('root');
    // Unknown grip
    expect(r.resolveUpward('B', 'X')).toBeUndefined();
  });

  it('overshadowing: child provider hides ancestor for its subtree', () => {
    const r = new SimpleResolver();
    r.setParents('A', [{ id: 'root', priority: 0 }]);
    r.setParents('B', [{ id: 'A', priority: 0 }]);
    r.registerLocalProvider('root', 'G');
    // A shadows root for G
    r.registerLocalProvider('A', 'G');
    expect(r.resolveUpward('B', 'G')).toBe('A');
    expect(r.getResolvedProvider('B', 'G')).toBe('A');
    expect(r.getResolvedProvider('A', 'G')).toBe('A');
  });
});

describe('Tap registration (add)', () => {
  it('propagates to descendants; prunes branches overshadowed by closer providers', () => {
    const r = new SimpleResolver();
    // root <- A <- B; A <- C
    r.setParents('A', [{ id: 'root', priority: 0 }]);
    r.setParents('B', [{ id: 'A', priority: 0 }]);
    r.setParents('C', [{ id: 'A', priority: 0 }]);
    // Register local provider at A for G2 to overshadow G2 from root
    r.registerLocalProvider('A', 'G2');
    // Add tap at root for {G1, G2}
    r.registerLocalProvider('root', 'G1');
    r.registerLocalProvider('root', 'G2');
    r.propagateAdd('root', new Set(['G1', 'G2']));
    // B and C should resolve G1 to root; G2 should resolve to A (overshadowed at A)
    expect(r.getResolvedProvider('B', 'G1')).toBe('root');
    expect(r.getResolvedProvider('C', 'G1')).toBe('root');
    expect(r.getResolvedProvider('B', 'G2')).toBe('A');
    expect(r.getResolvedProvider('C', 'G2')).toBe('A');
  });
  it('visited-set keyed by (node, grip-subset) prevents revisits', () => {
    const r = new SimpleResolver();
    r.setParents('A', [{ id: 'root', priority: 0 }]);
    r.setParents('B', [{ id: 'A', priority: 0 }]);
    r.registerLocalProvider('root', 'G');
    // Should terminate quickly without revisits; sanity run
    r.propagateAdd('root', new Set(['G']));
    expect(r.getResolvedProvider('B', 'G')).toBe('root');
  });
});

describe('Tap removal (remove)', () => {
  it('clears mappings pointing to removed provider; re-resolves to next-best or default', () => {
    const r = new SimpleResolver();
    r.setParents('A', [{ id: 'root', priority: 0 }]);
    r.setParents('B', [{ id: 'A', priority: 0 }]);
    r.registerLocalProvider('root', 'G');
    r.propagateAdd('root', new Set(['G']));
    expect(r.getResolvedProvider('B', 'G')).toBe('root');
    // Now add provider at A and propagate
    r.registerLocalProvider('A', 'G');
    r.propagateAdd('A', new Set(['G']));
    expect(r.getResolvedProvider('B', 'G')).toBe('A');
    // Remove A provider and propagate removal -> should fall back to root
    r.propagateRemove('A', new Set(['G']));
    expect(r.getResolvedProvider('B', 'G')).toBe('root');
  });
  it('does not affect branches overshadowed by local providers', () => {
    const r = new SimpleResolver();
    r.setParents('A', [{ id: 'root', priority: 0 }]);
    r.setParents('B', [{ id: 'A', priority: 0 }]);
    r.setParents('C', [{ id: 'A', priority: 0 }]);
    // root provides G; A shadows with its own G
    r.registerLocalProvider('root', 'G');
    r.propagateAdd('root', new Set(['G']));
    r.registerLocalProvider('A', 'G');
    r.propagateAdd('A', new Set(['G']));
    expect(r.getResolvedProvider('B', 'G')).toBe('A');
    expect(r.getResolvedProvider('C', 'G')).toBe('A');
    // Remove root provider should not affect B/C since A overshadows
    r.propagateRemove('root', new Set(['G']));
    expect(r.getResolvedProvider('B', 'G')).toBe('A');
    expect(r.getResolvedProvider('C', 'G')).toBe('A');
  });
});

describe('Parameter grips and invalidation', () => {
  it.todo('declared parameterGrips invalidate destination mapping on local override changes');
  it.todo('parameter drip switching keeps connection when same provider remains selected');
});

describe('Lifecycle and disposal', () => {
  it.todo('on last consumer, shared drip is released and mapping optionally cleared');
  it.todo('disposeContext removes all mappings for that context; queries re-create on demand');
});


