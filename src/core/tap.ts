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

  // Higher is better; -Infinity means cannot provide in this ctx
  match(ctx: GripContext): number;

  // Produce a Drip for the Grip within this ctx (may query grok for params)
  produce<T>(grip: Grip<T>, ctx: GripContext, grok: Grok): Drip<T>;
}
