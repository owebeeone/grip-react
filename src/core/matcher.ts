import type { Grip } from './grip';
import type { Tap, TapFactory } from './tap';
import type { Query } from './query';

/** Result contract: (false with 0), or (true with score) */
export type MatchScore = { matched: boolean; score: number };

/** Association between a Query and a Tap (or Factory) with optional extra score */
export interface QueryBinding {
  query: Query;
  tap?: Tap;
  factory?: TapFactory;       // lazy: only invoked if selected
  extraScore?: number;        // additive
  /** optional label for debugging */
  label?: string;
}

/** What the registry returns when we evaluate a set */
export interface MatchCandidate {
  tap: Tap;                   // resolved (factory invoked lazily on win)
  query: Query;
  score: number;              // final computed score used for ranking
}

/**
 * A registry of (Query -> Tap|Factory) bindings.
 * - Add/remove bindings by Tap (or factory label).
 * - Evaluate against a "context snapshot" (your engine provides it).
 * - Collision rule: if multiple candidates provide the *same* Grip, highest score wins.
 */
export interface MatcherRegistry {
  /** Add a (query -> tap) binding */
  add(query: Query, tap: Tap, extraScore?: number, label?: string): this;

  /** Add a (query -> factory) binding (lazy instantiation) */
  addFactory(query: Query, factory: TapFactory, extraScore?: number, label?: string): this;

  /** Remove all bindings that reference this tap (instance or by id/label) */
  removeTap(tapOrIdOrLabel: Tap | string): number;

  /** Remove by predicate (escape hatch) */
  removeWhere(fn: (b: QueryBinding) => boolean): number;

  /** Snapshot all current bindings */
  list(): ReadonlyArray<QueryBinding>;

  /**
   * Evaluate all bindings for a particular request.
   * `requestedGrip` is the grip the engine is resolving (one-at-a-time resolution).
   * `ctx` abstracts the runtime accessors your engine provides (params, proximity, etc).
   *
   * Returns all *matching* candidates scored; engine picks winners per “provided grip”.
   */
  evaluate<T>(
    requestedGrip: Grip<T>,
    ctx: MatchEvalContext
  ): ReadonlyArray<MatchCandidate>;
}

/** The minimal info a matcher needs at runtime (un-opinionated wrapper over your GROK). */
export interface MatchEvalContext {
  /** read parameter from dest context lineage */
  getDestParam<T>(g: Grip<T>): T | undefined;

  /** read parameter from provider/home lineage if needed */
  getHomeParam<T>(g: Grip<T>): T | undefined;

  /** optional: proximity, tags, etc. (if you fold tie-breakers into scoring) */
  proximityBias?: (tap: Tap) => number; // e.g., near=+2, far=0
  categoryBias?: (tap: Tap) => number;  // e.g., prefer ['live'] => +1
}
