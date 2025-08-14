import { Drip } from "./drip";
import { Grip } from "./grip";
import { GripContext } from "./context";
import type { Grok } from "./grok";
import type { Tap } from "./tap";
import { BaseTap } from "./base_tap";

export interface SimpleTapHandle<T> {
  get: () => T;
  set: (v: T) => void;
}

// Public alias for ergonomics in app code
export type SimpleTap<T> = SimpleTapHandle<T>;

// Factory for a no-op/simple null controller usable as a default grip value
export function makeNullSimpleTap<T>(fallback: T): SimpleTap<T> {
  return {
    get: () => fallback,
    set: (_: T) => { /* no-op */ },
  } as SimpleTap<T>;
}

class SimpleValueTap<T> extends BaseTapNoParams implements SimpleTap<T> {
  private currentValue: T | undefined;
  private hasHandleGrip: boolean;

  constructor(grip: Grip<T>, initial: T, opts?: { handleGrip?: Grip<any> }) 
  { 
    super({ provides: (opts?.handleGrip ? [grip, opts.handleGrip] : [grip]) });
    this.initial = initial;
    this.hasHandleGrip = !!opts?.handleGrip;
  }

  
  produce(opts?: {destContext?: GripContext}) {
    //todo
      }

  get(): T | undefined {
    return this.currentValue;
  }


  set(value: T): void {

  }
}

// Helper to create a simple value tap for a single Grip.
// - Provides a per-(tap, grip, destCtx) drip with an initial value
// - Exposes get/set helpers that operate via grok.query to reuse engine cache/drips

export function createSimpleValueTap<T>(
  grip: Grip<T>,
  opts?: { initial?: T; handleGrip?: Grip<any> }
): SimpleTap<T> {

  const tap: Tap = new SimpleValueTap();
  return { tap, get, set };
}


