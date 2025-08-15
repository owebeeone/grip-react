import { Drip } from "./drip";
import { Grip } from "./grip";
import { GripContext } from "./context";
import type { Grok } from "./grok";
import type { Tap } from "./tap";
import { BaseTapNoParams } from "./base_tap";
import { ProducerRecord } from "./graph";

export interface SimpleTapHandle<T> {
  get: () => T | undefined;
  set: (v: T) => void;
}

// Public alias for ergonomics in app code
export type SimpleTap<T> = SimpleTapHandle<T>;

/**
 * A simple tap contains it's value.
 */
class SimpleValueTap<T> extends BaseTapNoParams implements SimpleTap<T> {
  private currentValue: T | undefined;
  private valueGrip: Grip<T>;
  private handleGrip: Grip<SimpleTapHandle<T>> | undefined;

  constructor(grip: Grip<T>, initial: T | undefined, opts?: { handleGrip?: Grip<any> }) 
  { 
    super({ provides: (opts?.handleGrip ? [grip, opts.handleGrip] : [grip]) });
    this.valueGrip = grip;
    this.handleGrip = opts?.handleGrip;
    this.currentValue = initial;
  }

  
  produce(opts?: {destContext?: GripContext}) {
    // We don't have any parameters.
    const updates = new Map<Grip<any>, any>([[this.valueGrip, this.currentValue]]);
    if (this.handleGrip) {
      updates.set(this.handleGrip, this);
    }
   
    this.publish(updates, opts?.destContext);
  }

  get(): T | undefined {
    return this.currentValue;
  }

  set(value: T): void {
    // Only produce if the value has changed.
    if (this.currentValue !== value) {
      this.currentValue = value;
      this.produce();
    }
  }
}

// Helper to create a simple value tap for a single Grip.
// - Provides a per-(tap, grip, destCtx) drip with an initial value
// - Exposes get/set helpers that operate via grok.query to reuse engine cache/drips

export function createSimpleValueTap<T>(
  grip: Grip<T>,
  opts?: { initial?: T; handleGrip?: Grip<any> }
): SimpleTap<T> {

  const tap: SimpleValueTap<T> = new SimpleValueTap<T>(
    grip, opts?.initial ?? grip.defaultValue, opts);
  return tap;
}


