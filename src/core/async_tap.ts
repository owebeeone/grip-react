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

  // Hooked by BaseTap when destination params change
  produceOnDestParams(destContext: GripContext | undefined): void {
    if (!destContext) return;
    this.kickoff(destContext);
  }

  // Recompute for all destinations or a specific one
  produce(opts?: { destContext?: GripContext }): void {
    if (opts?.destContext) {
      this.kickoff(opts.destContext);
      return;
    }
    const destinations = Array.from(this.producer?.getDestinations().keys() ?? []);
    for (const destNode of destinations) {
      const destCtx = destNode.get_context();
      if (!destCtx) continue;
      this.kickoff(destCtx);
    }
  }

  // Home params changed → update all destinations
  produceOnParams(): void {
    this.produce();
  }

  onConnect(dest: GripContext, grip: Grip<any>): void {
    super.onConnect(dest, grip);
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

  private kickoff(dest: GripContext): void {
    const key = this.getRequestKey(dest);
    if (!key) return; // insufficient params
    const state = this.getDestState(dest);
    const cached = this.asyncOpts.cacheTtlMs > 0 ? this.cache.get(key) : undefined;
    if (cached) {
      const updates = this.mapResultToUpdates(dest, cached.value);
      this.publish(updates, dest);
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

    this.buildRequest(dest, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return;
        // Latest-only guard
        if (this.asyncOpts.latestOnly && seq !== state.seq) return;
        if (this.asyncOpts.cacheTtlMs > 0 && key) this.cache.set(key, result, this.asyncOpts.cacheTtlMs);
        const updates = this.mapResultToUpdates(dest, result);
        this.publish(updates, dest);
      })
      .catch(() => {
        // Swallow network errors; optionally map to diagnostics in subclass
      })
      .finally(() => {
        if (state.deadlineTimer) { clearTimeout(state.deadlineTimer); this.allTimers.delete(state.deadlineTimer); state.deadlineTimer = undefined; }
      });
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


