import { BaseTap } from "./base_tap";
import { Grip } from "./grip";
import type { GripContext } from "./context";
import type { AsyncCache } from "./async_cache";
import { LruTtlCache } from "./async_cache";
import type { Tap } from "./tap";
import type { GripRecord, GripValue, Values, FunctionTapHandle } from "./function_tap";

interface DestState {
  controller?: AbortController;
  seq: number;
  key?: string;
  deadlineTimer?: any;
  pendingRetryArmed?: boolean;
}

export interface BaseAsyncTapOptions {
  debounceMs?: number; // apply at the caller site or via param-change coalescing
  cache?: AsyncCache<string, unknown>;
  cacheTtlMs?: number;
  latestOnly?: boolean; // default true
  deadlineMs?: number;  // optional overall timeout per request
}

/**
 * Base class for async taps with per-destination cancellation, caching and deadlines.
 * Subclasses implement request building and result mapping.
 */
export abstract class BaseAsyncTap extends BaseTap {
  protected readonly asyncOpts: Required<BaseAsyncTapOptions>;
  private readonly destState = new WeakMap<GripContext, DestState>();
  private readonly cache: AsyncCache<string, unknown>;
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly allControllers = new Set<AbortController>();
  private readonly allTimers = new Set<any>();

  constructor(opts: { provides: readonly Grip<any>[]; destinationParamGrips?: readonly Grip<any>[]; homeParamGrips?: readonly Grip<any>[]; async?: BaseAsyncTapOptions; }) {
    super({ provides: opts.provides, destinationParamGrips: opts.destinationParamGrips, homeParamGrips: opts.homeParamGrips });
    const a = opts.async ?? {};
    this.asyncOpts = {
      debounceMs: a.debounceMs ?? 0,
      cache: a.cache ?? new LruTtlCache<string, unknown>(200),
      cacheTtlMs: a.cacheTtlMs ?? 0,
      latestOnly: a.latestOnly ?? true,
      deadlineMs: a.deadlineMs ?? 0,
    };
    this.cache = this.asyncOpts.cache;
  }

  protected getDestState(dest: GripContext): DestState {
    let s = this.destState.get(dest);
    if (!s) { s = { seq: 0 }; this.destState.set(dest, s); }
    return s;
  }

  protected abstract getRequestKey(dest: GripContext): string | undefined;
  protected abstract buildRequest(dest: GripContext, signal: AbortSignal): Promise<unknown>;
  protected abstract mapResultToUpdates(dest: GripContext, result: unknown): Map<Grip<any>, any>;
  protected abstract getResetUpdates(dest: GripContext): Map<Grip<any>, any>;

  // Hooked by BaseTap when destination params change
  produceOnDestParams(destContext: GripContext | undefined): void {
    if (!destContext) return;
    // Only kickoff when requestKey is resolvable (dest params defined)
    const key = this.getRequestKey(destContext);
    if (!key) return;
    this.kickoff(destContext);
  }

  // Recompute for all destinations or a specific one
  produce(opts?: { destContext?: GripContext; forceRefetch?: boolean }): void {
    if (opts?.destContext) {
      this.kickoff(opts.destContext, opts.forceRefetch === true);
      return;
    }
    const destinations = Array.from(this.producer?.getDestinations().keys() ?? []);
    for (const destNode of destinations) {
      const destCtx = destNode.get_context();
      if (!destCtx) continue;
      this.kickoff(destCtx, opts?.forceRefetch === true);
    }
  }

  // Home params changed → update all destinations
  produceOnParams(): void {
    this.produce();
  }

  onConnect(dest: GripContext, grip: Grip<any>): void {
    // Override base to trigger produce ONLY if this is the first connected destination
    if ((this.producer?.getDestinations().size ?? 0) === 1) {
      super.onConnect(dest, grip);
    }
    this.kickoff(dest);
  }

  onDisconnect(dest: GripContext, grip: Grip<any>): void {
    try {
      const s = this.destState.get(dest);
      if (s) {
        s.controller?.abort();
        if (s.deadlineTimer) {
          clearTimeout(s.deadlineTimer);
          this.allTimers.delete(s.deadlineTimer);
          s.deadlineTimer = undefined;
        }
        this.destState.delete(dest);
      }
    } finally {
      super.onDisconnect(dest, grip);
    }
  }

  onDetach(): void {
    try {
      // cancel everything without iterating WeakMap keys
      for (const c of this.allControllers) { try { c.abort(); } catch {} }
      for (const t of this.allTimers) { try { clearTimeout(t); } catch {} }
      this.allControllers.clear();
      this.allTimers.clear();
    } finally {
      super.onDetach();
    }
  }

  private kickoff(dest: GripContext, forceRefetch?: boolean): void {
    const state = this.getDestState(dest);
    const prevKey = state.key;
    const key = this.getRequestKey(dest);

    // If params are insufficient now → abort any in-flight and clear outputs
    if (!key) {
      if (state.controller) state.controller.abort();
      state.key = undefined;
      const resets = this.getResetUpdates(dest);
      if (resets.size > 0) this.publish(resets, dest);
      return;
    }

    // If the effective request key changed → abort previous request; keep last values until new ones arrive (stale-while-revalidate)
    if (prevKey !== undefined && prevKey !== key) {
      if (state.controller) state.controller.abort();
    }
    const cached = (this.asyncOpts.cacheTtlMs > 0 && !forceRefetch) ? this.cache.get(key) : undefined;
    if (cached) {
      // Publish cached value to all destinations sharing this key
      state.key = key;
      const destinations = Array.from(this.producer?.getDestinations().keys() ?? []);
      for (const destNode of destinations) {
        const dctx = destNode.get_context();
        if (!dctx) continue;
        const k2 = this.getRequestKey(dctx);
        if (k2 !== key) continue;
        const updates = this.mapResultToUpdates(dctx, cached.value);
        this.publish(updates, dctx);
        // Mark each destination's state with the effective key to prevent repeated resets
        try { this.getDestState(dctx).key = key; } catch {}
      }
      return;
    }
    // If a request for this key is already in-flight, wait for it and then publish from cache
    const existing = this.pending.get(key);
    if (existing) {
      // Arm a one-time retry for this destination if the pending completes without a cache entry
      state.pendingRetryArmed = true;
      existing.then(() => {
        const fromCache = this.cache.get(key);
        if (!fromCache) return; // publish handled below in finally
      }).catch(() => { /* ignore; handled in finally */ }).finally(() => {
        const fromCache = this.cache.get(key);
        if (fromCache) {
          // Publish cached value to all destinations
          const destinations = Array.from(this.producer?.getDestinations().keys() ?? []);
          for (const destNode of destinations) {
            const dctx = destNode.get_context();
            if (!dctx) continue;
            const k2 = this.getRequestKey(dctx);
            if (k2 !== key) continue;
            const updates = this.mapResultToUpdates(dctx, fromCache.value);
            this.publish(updates, dctx);
            try { this.getDestState(dctx).key = key; } catch {}
          }
        } else if (state.pendingRetryArmed && this.pending.get(key) === undefined) {
          // No cache was produced; if dest still targets this key, retry once
          state.pendingRetryArmed = false;
          if (this.getRequestKey(dest) === key) {
            this.kickoff(dest, true);
          }
        }
      });
      return;
    }
    // Start new request
    state.seq += 1;
    const seq = state.seq;
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;
    this.allControllers.add(controller);
    state.key = key;
    if (state.deadlineTimer) { clearTimeout(state.deadlineTimer); this.allTimers.delete(state.deadlineTimer); state.deadlineTimer = undefined; }
    if (this.asyncOpts.deadlineMs > 0) {
      state.deadlineTimer = setTimeout(() => controller.abort(), this.asyncOpts.deadlineMs);
      this.allTimers.add(state.deadlineTimer);
    }
    const promise = this.buildRequest(dest, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        // Latest-only guard
        if (this.asyncOpts.latestOnly && seq !== state.seq) return;
        if (this.asyncOpts.cacheTtlMs > 0 && key) this.cache.set(key, result, this.asyncOpts.cacheTtlMs);
        // Publish to all destinations sharing this key to keep outputs in sync
        if (!this.producer) {
          console.error(`[AsyncTap] ERROR: producer is undefined after successful fetch for key=${key}. Cannot publish results.`);
          return;
        }
        const destinations = Array.from(this.producer.getDestinations().keys());
        console.log(`[AsyncTap] Publishing to ${destinations.length} destinations for key=${key}, tap=${(this as any).id}, homeContext=${this.homeContext?.id || 'NOT_ATTACHED'}`);
        for (const destNode of destinations) {
          const dctx = destNode.get_context();
          if (!dctx) {
            console.log(`[AsyncTap]   - Skipping destination: context is gone`);
            continue;
          }
          const k2 = this.getRequestKey(dctx);
          console.log(`[AsyncTap]   - Destination ${dctx.id} has key=${k2}, looking for key=${key}`);
          if (k2 !== key) continue;
          const updates = this.mapResultToUpdates(dctx, result);
          this.publish(updates, dctx);
          try { this.getDestState(dctx).key = key; } catch {}
        }
      })
      .catch(() => {
        // Swallow network errors; optionally map to diagnostics in subclass
      })
      .finally(() => {
        this.pending.delete(key);
        if (state.deadlineTimer) { clearTimeout(state.deadlineTimer); this.allTimers.delete(state.deadlineTimer); state.deadlineTimer = undefined; }
      });
    this.pending.set(key, promise);
  }
}

export interface AsyncValueTapConfig<T> extends BaseAsyncTapOptions {
  provides: Grip<T>;
  destinationParamGrips?: readonly Grip<any>[];
  requestKeyOf: (dest: GripContext) => string | undefined;
  fetcher: (dest: GripContext, signal: AbortSignal) => Promise<T>;
}

class SingleOutputAsyncTap<T> extends BaseAsyncTap {
  private readonly out: Grip<T>;
  private readonly keyOf: (dest: GripContext) => string | undefined;
  private readonly fetcher: (dest: GripContext, signal: AbortSignal) => Promise<T>;
  constructor(cfg: AsyncValueTapConfig<T>) {
    super({ provides: [cfg.provides], destinationParamGrips: cfg.destinationParamGrips, async: cfg });
    this.out = cfg.provides;
    this.keyOf = cfg.requestKeyOf;
    this.fetcher = cfg.fetcher;
  }
  protected getRequestKey(dest: GripContext): string | undefined { return this.keyOf(dest); }
  protected buildRequest(dest: GripContext, signal: AbortSignal): Promise<unknown> { return this.fetcher(dest, signal); }
  protected mapResultToUpdates(_dest: GripContext, result: unknown): Map<Grip<any>, any> {
    const updates = new Map<Grip<any>, any>();
    updates.set(this.out as unknown as Grip<any>, result as T);
    return updates;
  }
  protected getResetUpdates(_dest: GripContext): Map<Grip<any>, any> {
    const updates = new Map<Grip<any>, any>();
    updates.set(this.out as unknown as Grip<any>, undefined as unknown as T);
    return updates;
  }
}

export function createAsyncValueTap<T>(cfg: AsyncValueTapConfig<T>): Tap {
  // Do not leak class type; return as Tap
  return new SingleOutputAsyncTap<T>(cfg) as unknown as Tap;
}

// Multi-output async tap
export interface AsyncMultiTapConfig<Outs extends GripRecord, R = unknown, StateRec extends GripRecord = {}> extends BaseAsyncTapOptions {
  provides: ReadonlyArray<Values<Outs>>;
  destinationParamGrips?: readonly Grip<any>[];
  homeParamGrips?: readonly Grip<any>[];
  handleGrip?: Grip<FunctionTapHandle<StateRec>>;
  initialState?: ReadonlyArray<[Grip<any>, any]> | ReadonlyMap<Grip<any>, any>;
  requestKeyOf: (
    dest: GripContext,
    getState: <K extends keyof StateRec>(grip: StateRec[K]) => GripValue<StateRec[K]> | undefined
  ) => string | undefined;
  fetcher: (
    dest: GripContext,
    signal: AbortSignal,
    getState: <K extends keyof StateRec>(grip: StateRec[K]) => GripValue<StateRec[K]> | undefined
  ) => Promise<R>;
  mapResult: (
    dest: GripContext,
    result: R,
    getState: <K extends keyof StateRec>(grip: StateRec[K]) => GripValue<StateRec[K]> | undefined
  ) => ReadonlyMap<Values<Outs>, GripValue<Values<Outs>>>;
}

class MultiOutputAsyncTap<Outs extends GripRecord, R, StateRec extends GripRecord>
  extends BaseAsyncTap implements FunctionTapHandle<StateRec> {
  private readonly outs: ReadonlyArray<Values<Outs>>;
  private readonly keyOf: (
    dest: GripContext,
    getState: <K extends keyof StateRec>(grip: StateRec[K]) => GripValue<StateRec[K]> | undefined
  ) => string | undefined;
  private readonly fetcher: (
    dest: GripContext,
    signal: AbortSignal,
    getState: <K extends keyof StateRec>(grip: StateRec[K]) => GripValue<StateRec[K]> | undefined
  ) => Promise<R>;
  private readonly mapper: (
    dest: GripContext,
    result: R,
    getState: <K extends keyof StateRec>(grip: StateRec[K]) => GripValue<StateRec[K]> | undefined
  ) => ReadonlyMap<Values<Outs>, GripValue<Values<Outs>>>;
  readonly handleGrip?: Grip<FunctionTapHandle<StateRec>>;
  readonly state = new Map<Grip<any>, any>();
  constructor(cfg: AsyncMultiTapConfig<Outs, R, StateRec>) {
    const providesList = (cfg.handleGrip ? [...cfg.provides, cfg.handleGrip] : cfg.provides) as unknown as readonly Grip<any>[];
    super({ provides: providesList, destinationParamGrips: cfg.destinationParamGrips, homeParamGrips: cfg.homeParamGrips, async: cfg });
    this.outs = cfg.provides;
    this.keyOf = cfg.requestKeyOf;
    this.fetcher = cfg.fetcher;
    this.mapper = cfg.mapResult;
    this.handleGrip = cfg.handleGrip as unknown as Grip<FunctionTapHandle<StateRec>> | undefined;
    if (cfg.initialState) {
      const it = Array.isArray(cfg.initialState) ? cfg.initialState : Array.from((cfg.initialState as ReadonlyMap<Grip<any>, any>).entries());
      for (const [g, v] of it) this.state.set(g, v);
    }
  }
  protected getRequestKey(dest: GripContext): string | undefined { return this.keyOf(dest, this.getState.bind(this) as any); }
  protected buildRequest(dest: GripContext, signal: AbortSignal): Promise<unknown> { return this.fetcher(dest, signal, this.getState.bind(this) as any); }
  protected mapResultToUpdates(dest: GripContext, result: unknown): Map<Grip<any>, any> {
    const typed = this.mapper(dest, result as R, this.getState.bind(this) as any);
    const updates = new Map<Grip<any>, any>();
    for (const [g, v] of typed as ReadonlyMap<any, any>) {
      updates.set(g as unknown as Grip<any>, v);
    }
    if (this.handleGrip) {
      updates.set(this.handleGrip as unknown as Grip<any>, this as unknown as FunctionTapHandle<StateRec>);
    }
    return updates;
  }
  protected getResetUpdates(_dest: GripContext): Map<Grip<any>, any> {
    const updates = new Map<Grip<any>, any>();
    for (const g of this.outs) {
      updates.set(g as unknown as Grip<any>, undefined);
    }
    // Do not touch handleGrip on reset
    return updates;
  }
  getState<K extends keyof StateRec>(grip: StateRec[K]): GripValue<StateRec[K]> | undefined {
    return this.state.get(grip as unknown as Grip<any>) as GripValue<StateRec[K]> | undefined;
  }
  setState<K extends keyof StateRec>(grip: StateRec[K], value: GripValue<StateRec[K]> | undefined): void {
    const prev = this.state.get(grip as unknown as Grip<any>);
    if (prev === value) return;
    this.state.set(grip as unknown as Grip<any>, value);
    // Recompute for all destinations (will abort inflight and reuse cache if present)
    this.produce();
  }
}

export function createAsyncMultiTap<Outs extends GripRecord, R = unknown, StateRec extends GripRecord = {}>(cfg: AsyncMultiTapConfig<Outs, R, StateRec>): Tap {
  return new MultiOutputAsyncTap<Outs, R, StateRec>(cfg) as unknown as Tap;
}


