import { Grip } from "./grip";
import { GripContext } from "./context";
import type { Tap } from "./tap";
import { BaseTap } from "./base_tap";

// Type helpers for type-safe grips
export type GripRecord = Record<string, Grip<any>>;
export type GripValue<G extends Grip<any>> = G extends Grip<infer T> ? T : never;
export type Values<R extends GripRecord> = R[keyof R];

export interface FunctionTapHandle<StateRec extends GripRecord> {
  getState: <K extends keyof StateRec>(grip: StateRec[K]) => GripValue<StateRec[K]> | undefined;
  setState: <K extends keyof StateRec>(grip: StateRec[K], value: GripValue<StateRec[K]> | undefined) => void;
}

export type ComputeFn<
  Outs extends GripRecord,
  Home extends GripRecord,
  Dest extends GripRecord,
  StateRec extends GripRecord
> = (args: {
  dest?: GripContext;
  getHomeParam: <K extends keyof Home>(grip: Home[K]) => GripValue<Home[K]> | undefined;
  getDestParam: <K extends keyof Dest>(grip: Dest[K], dest?: GripContext) => GripValue<Dest[K]> | undefined;
  getState: <K extends keyof StateRec>(grip: StateRec[K]) => GripValue<StateRec[K]> | undefined;
}) => Map<Values<Outs>, GripValue<Values<Outs>>>;

export interface FunctionTapConfig<
  Outs extends GripRecord,
  Home extends GripRecord = {},
  Dest extends GripRecord = {},
  StateRec extends GripRecord = {}
> {
  provides: ReadonlyArray<Values<Outs>>;
  destinationParamGrips?: ReadonlyArray<Values<Dest>>;
  homeParamGrips?: ReadonlyArray<Values<Home>>;
  handleGrip?: Grip<FunctionTapHandle<StateRec>>;
  initialState?: ReadonlyArray<[Grip<any>, any]> | ReadonlyMap<Grip<any>, any>;
  compute: ComputeFn<Outs, Home, Dest, StateRec>;
}

/**
 * A flexible tap that computes outputs based on destination and home parameters,
 * plus optional local state. The compute() function is invoked whenever any
 * subscribed parameter or local state changes.
 */
export class FunctionTap<
  Outs extends GripRecord,
  Home extends GripRecord = {},
  Dest extends GripRecord = {},
  StateRec extends GripRecord = {}
> extends BaseTap implements FunctionTapHandle<StateRec> {
  protected readonly computeFn: ComputeFn<Outs, Home, Dest, StateRec>;
  readonly handleGrip?: Grip<FunctionTapHandle<StateRec>>;
  readonly state = new Map<Grip<any>, any>();
  // Subscriptions for home param drips
  private homeParamUnsubs: Array<() => void> = [];

  constructor(config: FunctionTapConfig<Outs, Home, Dest, StateRec>) {
    super({
      provides: (config.handleGrip ? [...config.provides, config.handleGrip] : config.provides) as unknown as readonly Grip<any>[],
      destinationParamGrips: config.destinationParamGrips as unknown as readonly Grip<any>[],
      homeParamGrips: config.homeParamGrips as unknown as readonly Grip<any>[],
    });
    this.computeFn = config.compute;
    this.handleGrip = config.handleGrip as unknown as Grip<FunctionTapHandle<StateRec>> | undefined;
    if (config.initialState) {
      const it = Array.isArray(config.initialState)
        ? config.initialState
        : Array.from((config.initialState as ReadonlyMap<Grip<any>, any>).entries());
      for (const [g, v] of it) this.state.set(g, v);
    }
  }

  // Handle API
  getState<K extends keyof StateRec>(grip: StateRec[K]): GripValue<StateRec[K]> | undefined { return this.state.get(grip as unknown as Grip<any>) as GripValue<StateRec[K]> | undefined; }
  setState<K extends keyof StateRec>(grip: StateRec[K], value: GripValue<StateRec[K]> | undefined): void {
    const prev = this.state.get(grip as unknown as Grip<any>);
    if (prev === value) return;
    this.state.set(grip as unknown as Grip<any>, value);
    this.produce();
  }

  // Wire up home param subscriptions in addition to BaseTap destination param handling
  onAttach(home: GripContext): void {
    super.onAttach(home);
    // Subscribe to homeParamGrips (if any) at the home context lineage
    if (this.homeParamGrips && this.homeParamGrips.length > 0) {
      for (const g of this.homeParamGrips) {
        const d = home.getOrCreateConsumer(g);
        // Ensure resolution to a provider for the home parameter
        home.getGrok().resolver.addConsumer(home, g as unknown as Grip<any>);
        const unsub = d.subscribe(() => {
          this.produce();
        });
        this.homeParamUnsubs.push(unsub);
      }
    }
  }

  onDetach(): void {
    try {
      for (const u of this.homeParamUnsubs) u();
    } finally {
      this.homeParamUnsubs = [];
      super.onDetach();
    }
  }

  private computeFor(dest?: GripContext): Map<Grip<any>, any> {
    const getHomeParam = <K extends keyof Home>(g: Home[K]) => this.homeContext?.getOrCreateConsumer(g as unknown as Grip<any>).get() as GripValue<Home[K]> | undefined;
    const getDestParam = <K extends keyof Dest>(g: Dest[K], d?: GripContext) => (d ?? dest ?? this.homeContext)?.getOrCreateConsumer(g as unknown as Grip<any>).get() as GripValue<Dest[K]> | undefined;
    const getState = <K extends keyof StateRec>(g: StateRec[K]) => this.state.get(g as unknown as Grip<any>) as GripValue<StateRec[K]> | undefined;
    const typedResult = this.computeFn({ dest, getHomeParam, getDestParam, getState });
    const result = new Map<Grip<any>, any>();
    for (const [grip, value] of typedResult) {
      result.set(grip as unknown as Grip<any>, value);
    }
    if (this.handleGrip) {
      result.set(this.handleGrip as unknown as Grip<any>, this as FunctionTapHandle<StateRec>);
    }
    return result;
  }

  // Publish current state for all known destinations or a specific one
  produce(opts?: { destContext?: GripContext }): void {
    if (opts?.destContext) {
      const updates = this.computeFor(opts.destContext);
      this.publish(updates, opts.destContext);
      return;
    }
    // Publish to all destinations for this producer
    const destinations = Array.from(this.producer?.getDestinations().keys() ?? []);
    if (destinations.length === 0) return;
    for (const destNode of destinations) {
      const destCtx = destNode.get_context();
      if (!destCtx) continue;
      const updates = this.computeFor(destCtx);
      this.publish(updates, destCtx);
    }
  }

  // Home param changed
  produceOnParams(): void {
    this.produce();
  }

  // Destination parameter changed for a specific destination
  produceOnDestParams(destContext: GripContext | undefined): void {
    this.produce({ destContext });
  }
}

export function createFunctionTap<
  Outs extends GripRecord,
  Home extends GripRecord = {},
  Dest extends GripRecord = {},
  StateRec extends GripRecord = {}
>(config: FunctionTapConfig<Outs, Home, Dest, StateRec>): FunctionTap<Outs, Home, Dest, StateRec> {
  return new FunctionTap<Outs, Home, Dest, StateRec>(config);
}


