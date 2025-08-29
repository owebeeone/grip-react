import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip } from "./drip";
import type { Grok } from "./grok";
import type { GripContextLike } from "./context";

// A Tap advertises it can provide one or more Grips.
// match(ctx) returns a score; <= -Infinity means "no".
// produce() returns a Drip for the requested Grip.
// (MVP: single-output path; multi-output & feeders can come next.)
export interface Tap {
  readonly kind: "Tap";

  provides: readonly Grip<any>[];
  // Parameters read from the destination context lineage (affect a single destination)
  destinationParamGrips?: readonly Grip<any>[];
  // Parameters read from the home (provider) context lineage (affect all destinations under the provider)
  homeParamGrips?: readonly Grip<any>[];

  // Lifecycle: engine informs tap when attached/detached at a home context
  // Grok is implicit; contexts must belong to the same engine (enforced by the engine)
  onAttach?(home: GripContext | GripContextLike): void;
  onDetach?(): void;

  getHomeContext(): GripContext | undefined;

  getParamsContext(): GripContext | undefined;

  // Lifecycle: engine informs tap when a destination context connects/disconnects to a provided grip
  // Tap can derive grok via its stored home, so no grok parameter is needed
  onConnect?(dest: GripContext, grip: Grip<any>): void;
  onDisconnect?(dest: GripContext, grip: Grip<any>): void;

  // Produce for the current state. If destContext is provided, then only
  // provide the updates for the destination context provided.
  produce(opts?: { destContext?: GripContext }): void;

  // A grip on an input parameter has changed.
  produceOnParams?(paramGrip: Grip<any>): void;

  // A grip on a destination parameter has changed.
  produceOnDestParams?(destContext: GripContext | undefined, paramGrip: Grip<any>): void;
}

/**
 * A factory for a Tap.
 *
 * This is a lazy factory that is only instantiated if the query matches.
 *
 * The Matcher will need to know what Grips the Tap provides so that it can
 * determine if the Tap will be selected.
 */
export interface TapFactory {
  readonly kind: "TapFactory";
  label?: string;
  provides: readonly Grip<any>[];
  build(): Tap;
}

// Optional helper interface for producers that can be activated/deactivated
export interface ActivatableProducer {
  activate?(requestedGrips?: ReadonlySet<Grip<any>>): void;
  deactivate?(): void;
}

// Optional: richer Tap variant that can return a controller object alongside the drip
export interface TapWithController<TDrip = any, TController = any> extends Tap {
  produceWithController?<T>(
    grip: Grip<T>,
    ctx: GripContext,
    grok: Grok,
  ): { drip: Drip<T>; controller: TController };
}
