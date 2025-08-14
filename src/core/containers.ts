import { GripContext } from "./context";

// Common interface for context containers that can be used with useGrip and tap attachment
export interface GripContextLike {
  getGripConsumerContext(): GripContext; // where useGrip should read from
  getGripHomeContext(): GripContext;     // where taps should be attached by default
}

// Dual-context container: home (inputs/params) and presentation (outputs)
export class DualContextContainer implements GripContextLike {
  readonly home: GripContext;
  readonly presentation: GripContext;

  constructor(home: GripContext, presentation: GripContext) {
    this.home = home;
    this.presentation = presentation;
  }

  getGripConsumerContext(): GripContext { return this.presentation; }
  getGripHomeContext(): GripContext { return this.home; }
}


