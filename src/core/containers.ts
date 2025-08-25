import { GripContext } from "./context";
import { Grok } from "./grok";

// Common interface for context containers that can be used with useGrip and tap attachment
export interface GripContextLike {
  getGripConsumerContext(): GripContext; // where useGrip should read from
  getGripHomeContext(): GripContext;     // where taps should be attached by default
}

// Dual-context container: home (inputs/params) and presentation (outputs)
export class DualContextContainer implements GripContextLike {


  readonly kind: "DualContextContainer" = "DualContextContainer";
  readonly grok: Grok;
  readonly home: GripContext;
  readonly presentation: GripContext;

  constructor(home: GripContext, presentation: GripContext) {
    this.home = home;
    this.presentation = presentation;
    this.grok = home.getGrok();
  }

  getGripConsumerContext(): GripContext { return this.presentation; }
  getGripHomeContext(): GripContext { return this.home; }
  getGrok(): Grok { return this.grok; }
}


