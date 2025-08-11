import { Grip } from "./grip";
import { GripContext } from "./context";
import { Drip } from "./drip";
import type { Grok } from "./grok";

// A Tap advertises it can provide one or more Grips.
// match(ctx) returns a score; <= -Infinity means "no".
// produce() returns a Drip for the requested Grip.
// (MVP: single-output path; multi-output & feeders can come next.)
export interface Tap {
  id: string;
  provides: readonly Grip<any>[];
  // Optional: declare parameter grips used by this tap
  parameterGrips?: readonly Grip<any>[];
  // Produce a Drip for the Grip within this ctx (may query grok for params)
  produce<T>(grip: Grip<T>, ctx: GripContext, grok: Grok): Drip<T>;
}

// Optional helper interface for producers that can be activated/deactivated
export interface ActivatableProducer {
  activate?(requestedGrips?: ReadonlySet<Grip<any>>): void;
  deactivate?(): void;
}

// Optional: richer Tap variant that can return a controller object alongside the drip
export interface TapWithController<TDrip = any, TController = any> extends Tap {
  produceWithController?<T>(grip: Grip<T>, ctx: GripContext, grok: Grok): { drip: Drip<T>; controller: TController };
}