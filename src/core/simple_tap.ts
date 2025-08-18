import { Drip } from "./drip";
import { Grip } from "./grip";
import { GripContext } from "./context";
import type { Grok } from "./grok";
import type { Tap } from "./tap";
import { BaseTapNoParams } from "./base_tap";

export interface SimpleTapHandle<T> {
  get: () => T | undefined;
  set: (v: T | undefined) => void;
}

// Public alias for ergonomics in app code
export type SimpleTap<T> = SimpleTapHandle<T>;

/**
 * A simple tap contains it's value.
 */
export class SimpleValueTap<T> extends BaseTapNoParams implements SimpleTap<T>, Tap {
  private currentValue: T | undefined;
  private valueGrip: Grip<T>;
  private handleGrip: Grip<SimpleTapHandle<T>> | undefined;
  private listeners = new Set<() => void>();

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

  set(value: T | undefined): void {
    // Only produce if the value has changed.
    if (this.currentValue !== value) {
      this.currentValue = value;
      this.produce();
      this.listeners.forEach(l => l());
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// Helper to create a simple value tap for a single Grip.
// - Provides a per-(tap, grip, destCtx) drip with an initial value
// - Exposes get/set helpers that operate via grok.query to reuse engine cache/drips

export function createSimpleValueTap<T>(
  grip: Grip<T>,
  opts?: { initial?: T; handleGrip?: Grip<any> }
): SimpleValueTap<T> {

  const tap: SimpleValueTap<T> = new SimpleValueTap<T>(
    grip, opts?.initial ?? grip.defaultValue, opts);
  return tap;
}


// Multi-value simple tap
export interface MultiSimpleTapHandle {
	get: (grip: Grip<any>) => any | undefined;
	set: (grip: Grip<any>, v: any | undefined) => void;
  setAll: (values: Map<Grip<any>, any | undefined>) => void;
}

export type MultiSimpleTap = MultiSimpleTapHandle;

export class MultiSimpleValueTap extends BaseTapNoParams implements MultiSimpleTap, Tap {
    private readonly values = new Map<Grip<any>, any | undefined>();
    private readonly valueGrips: ReadonlyArray<Grip<any>>;
    private readonly handleGrip?: Grip<MultiSimpleTapHandle>;

    /**
     * Merge semantics for initialization:
     * - Tracked set S = union(grips, gripsMap?.keys())
     * - For g in S:
     *   - if gripsMap has g: use that value (even if undefined)
     *   - else if g is in grips: use g.defaultValue
     *   - else: leave undefined
     */
    constructor(grips: ReadonlyArray<Grip<any>>, gripsMap: Map<Grip<any>, any | undefined> | undefined, opts?: { handleGrip?: Grip<any> }) {
        const providesList = (opts?.handleGrip ? [...grips, opts.handleGrip] : grips) as unknown as readonly Grip<any>[];
        super({ provides: providesList });
        this.valueGrips = grips;
        this.handleGrip = opts?.handleGrip as unknown as Grip<MultiSimpleTapHandle> | undefined;

        const tracked = new Set<Grip<any>>();
        for (const g of grips) tracked.add(g);
        if (gripsMap) for (const g of gripsMap.keys()) tracked.add(g);

        for (const g of tracked) {
            if (gripsMap?.has(g)) {
                this.values.set(g, gripsMap.get(g));
            } else if (grips.includes(g)) {
                this.values.set(g, g.defaultValue);
            } else {
                this.values.set(g, undefined);
            }
        }
    }

    setAll(values: Map<Grip<any>, any | undefined>): void {
        for (const [g, v] of values) {
            if (this.handleGrip && (g as unknown as Grip<any>) === (this.handleGrip as unknown as Grip<any>)) {
                throw new Error("Cannot set the self/handle grip value via setAll");
            }
            if (!this.values.has(g)) {
                throw new Error("Cannot set value for non-tracked grip on MultiSimpleValueTap");
            }
        }
        let anyChanged = false;
        for (const [g, v] of values) {
            const prev = this.values.get(g);
            if (prev !== v) {
                this.values.set(g, v);
                // publish only this changed grip
                this.produce({ changed: g });
                anyChanged = true;
            }
        }
        if (!anyChanged) return;
    }

	produce(opts?: { destContext?: GripContext; changed?: Grip<any> }) {
		const updates = new Map<Grip<any>, any>();
		if (opts?.changed) {
			updates.set(opts.changed as unknown as Grip<any>, this.values.get(opts.changed));
		} else {
			for (const g of this.valueGrips) {
				updates.set(g as unknown as Grip<any>, this.values.get(g));
			}
			if (this.handleGrip) updates.set(this.handleGrip as unknown as Grip<any>, this as MultiSimpleTap);
		}
		this.publish(updates, opts?.destContext);
	}

	get(grip: Grip<any>): any | undefined {
		return this.values.get(grip);
	}

	set(grip: Grip<any>, value: any | undefined): void {
		if (this.handleGrip && (grip as unknown as Grip<any>) === (this.handleGrip as unknown as Grip<any>)) {
			throw new Error("Cannot set the self/handle grip value");
		}
		if (!this.values.has(grip)) {
			throw new Error("Cannot set value for non-provided grip on MultiSimpleValueTap");
		}
		const prev = this.values.get(grip);
		if (prev !== value) {
			this.values.set(grip, value);
			this.produce({ changed: grip });
		}
	}
}

/**
 * Create a multi-value simple tap.
 *
 * Config semantics (equal priority):
 * - Tracked grips = union(config.grips, config.gripMap?.keys())
 * - Initialization per grip g:
 *   - if config.gripMap has g: use that value (even if undefined)
 *   - else if g is in config.grips: use g.defaultValue
 *   - else: leave undefined
 */
export function createMultiSimpleValueTap(config: {
    grips?: ReadonlyArray<Grip<any>>;
    gripMap?: Map<Grip<any>, any | undefined>;
    handleGrip?: Grip<any>;
}): MultiSimpleTap {
    const resolvedGrips: ReadonlyArray<Grip<any>> = config.grips ?? Array.from(config.gripMap?.keys() ?? []);
    const tap = new MultiSimpleValueTap(resolvedGrips, config.gripMap, { handleGrip: config.handleGrip });
    return tap;
}


