import { Grip } from "./grip";
import { GripContext } from "./context";
import type { Tap } from "./tap";
import { BaseTapNoParams } from "./base_tap";

export interface AtomTapHandle<T> {
  get: () => T;
  set(value: T): void;
  update(updater: (prev: T) => T): void;
}

// Public alias for ergonomics in app code
export type AtomTap<T> = AtomTapHandle<T>;

/**
 * A simple atom-style tap that contains its own value and publishes updates.
 */
export class AtomValueTap<T> extends BaseTapNoParams implements AtomTap<T>, Tap {
  private currentValue: T;
  private valueGrip: Grip<T>;
  private handleGrip: Grip<AtomTapHandle<T>> | undefined;
  private listeners = new Set<() => void>();

  constructor(grip: Grip<T>, initial: T, opts?: { handleGrip?: Grip<any> }) {
    super({ provides: opts?.handleGrip ? [grip, opts.handleGrip] : [grip] });
    this.valueGrip = grip;
    this.handleGrip = opts?.handleGrip;
    this.currentValue = initial;
  }

  produce(opts?: { destContext?: GripContext }) {
    const updates = new Map<Grip<any>, any>([[this.valueGrip, this.currentValue]]);
    if (this.handleGrip) {
      updates.set(this.handleGrip, this);
    }
    this.publish(updates, opts?.destContext);
  }

  get(): T {
    return this.currentValue as T;
  }

  set(next: T): void {
    const nextValue = next;
    if (this.currentValue !== nextValue) {
      this.currentValue = nextValue;
      this.produce();
      this.listeners.forEach((l) => l());
    }
  }

  update(updater: (prev: T) => T): void {
    this.set(updater(this.currentValue));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// Helper to create a single-grip atom value tap
// - Provides a per-(tap, grip, destCtx) drip with an initial value
// - Exposes get/set helpers that operate via grok.query to reuse engine cache/drips

// Overload 1: When initial value is provided and is non-nullable, return AtomValueTap with non-nullable type
export function createAtomValueTap<T>(
  grip: Grip<T | undefined>,
  opts: { initial: NonNullable<T>; handleGrip?: Grip<any> },
): AtomValueTap<NonNullable<T>>;

// Overload 2: Standard case - return AtomValueTap with original grip type
export function createAtomValueTap<T>(
  grip: Grip<T>,
  opts?: { initial?: T; handleGrip?: Grip<any> },
): AtomValueTap<T>;

// Implementation
export function createAtomValueTap<T>(
  grip: Grip<T>,
  opts?: { initial?: T | undefined; handleGrip?: Grip<any> },
): AtomValueTap<T> {
  const tap = new AtomValueTap<T>(grip, opts?.initial ?? grip.defaultValue!, opts);
  return tap;
}

// Type helpers for type-safe grips (mirrors function_tap.ts)
export type GripRecord = Record<string, Grip<any>>;
export type GripValue<G extends Grip<any>> = G extends Grip<infer T> ? T : never;
export type Values<R extends GripRecord> = R[keyof R];

// Multi-value atom tap
export interface MultiAtomTapHandle<Outs extends GripRecord = any> {
  get: <K extends keyof Outs>(grip: Outs[K]) => GripValue<Outs[K]> | undefined;
  getAll: () => ReadonlyMap<Values<Outs>, GripValue<Values<Outs>> | undefined>;
  set<K extends keyof Outs>(grip: Outs[K], next: GripValue<Outs[K]> | undefined): void;
  update<K extends keyof Outs>(
    grip: Outs[K],
    updater: (prev: GripValue<Outs[K]> | undefined) => GripValue<Outs[K]> | undefined,
  ): void;
  setAll(values: Map<Values<Outs>, GripValue<Values<Outs>> | undefined>): void;
  updateAll(
    updater: (
      current: ReadonlyMap<Values<Outs>, GripValue<Values<Outs>> | undefined>,
    ) => Map<Values<Outs>, GripValue<Values<Outs>> | undefined>,
  ): void;
}

export type MultiAtomTap<Outs extends GripRecord = any> = MultiAtomTapHandle<Outs>;

export class MultiAtomValueTap<Outs extends GripRecord = any>
  extends BaseTapNoParams
  implements MultiAtomTap<Outs>, Tap
{
  private readonly values = new Map<Values<Outs>, GripValue<Values<Outs>> | undefined>();
  private readonly valueGrips: ReadonlyArray<Values<Outs>>;
  private readonly handleGrip?: Grip<MultiAtomTapHandle<Outs>>;

  /**
   * Merge semantics for initialization:
   * - Tracked set S = union(grips, gripsMap?.keys())
   * - For g in S:
   *   - if gripsMap has g: use that value (even if undefined)
   *   - else if g is in grips: use g.defaultValue
   *   - else: leave undefined
   */
  constructor(
    grips: ReadonlyArray<Values<Outs>>,
    gripsMap: Map<Values<Outs>, GripValue<Values<Outs>> | undefined> | undefined,
    opts?: { handleGrip?: Grip<MultiAtomTapHandle<Outs>> },
  ) {
    const providesList = (opts?.handleGrip
      ? [...grips, opts.handleGrip]
      : grips) as unknown as readonly Grip<any>[];
    super({ provides: providesList });
    this.valueGrips = grips;
    this.handleGrip = opts?.handleGrip as unknown as Grip<MultiAtomTapHandle<Outs>> | undefined;

    const tracked = new Set<Values<Outs>>();
    for (const g of grips) tracked.add(g);
    if (gripsMap) for (const g of gripsMap.keys()) tracked.add(g);

    for (const g of tracked) {
      if (gripsMap?.has(g)) {
        this.values.set(g, gripsMap.get(g));
      } else if (grips.includes(g)) {
        this.values.set(g, (g as unknown as Grip<any>).defaultValue);
      } else {
        this.values.set(g, undefined);
      }
    }
  }

  update<K extends keyof Outs>(grip: Outs[K], updater: (prev: GripValue<Outs[K]> | undefined) => GripValue<Outs[K]> | undefined): void {
    this.set(grip, updater(this.values.get(grip)));
  }

  updateAll(updater: (current: ReadonlyMap<Values<Outs>, GripValue<Values<Outs>> | undefined>) => Map<Values<Outs>, GripValue<Values<Outs>> | undefined>): void {
    this.setAll(updater(this.values))
  }

  setAll(values: Map<Values<Outs>, GripValue<Values<Outs>> | undefined>): void {
    const nextMap = values;

    for (const [g] of nextMap) {
      if (
        this.handleGrip &&
        (g as unknown as Grip<any>) === (this.handleGrip as unknown as Grip<any>)
      ) {
        throw new Error("Cannot set the self/handle grip value via setAll");
      }
      if (!this.values.has(g)) {
        throw new Error("Cannot set value for non-tracked grip on MultiAtomValueTap");
      }
    }

    const changed: Grip<any>[] = [];
    for (const [g, v] of nextMap) {
      const prev = this.values.get(g);
      if (prev !== v) {
        this.values.set(g, v);
        changed.push(g as unknown as Grip<any>);
      }
    }
    if (changed.length) {
      this.produce({ changed });
    }
  }

  produce(opts?: { destContext?: GripContext; changed?: Grip<any> | Grip<any>[] }) {
    const updates = new Map<Grip<any>, any>();
    const changedArray = Array.isArray(opts?.changed)
      ? (opts?.changed as Grip<any>[])
      : opts?.changed
        ? [opts.changed]
        : undefined;
    if (changedArray?.length) {
      for (const g of changedArray) {
        updates.set(g as unknown as Grip<any>, this.values.get(g as unknown as Values<Outs>));
      }
    } else {
      for (const g of this.valueGrips) {
        updates.set(g as unknown as Grip<any>, this.values.get(g));
      }
      if (this.handleGrip)
        updates.set(this.handleGrip as unknown as Grip<any>, this as MultiAtomTap<Outs>);
    }
    this.publish(updates, opts?.destContext);
  }

  get<K extends keyof Outs>(grip: Outs[K]): GripValue<Outs[K]> | undefined {
    return this.values.get(grip as unknown as Values<Outs>) as GripValue<Outs[K]> | undefined;
  }

  getAll(): ReadonlyMap<Values<Outs>, GripValue<Values<Outs>> | undefined> {
    return this.values;
  }

  set<K extends keyof Outs>(grip: Outs[K], nextValue: GripValue<Outs[K]> | undefined): void {
    if (
      this.handleGrip &&
      (grip as unknown as Grip<any>) === (this.handleGrip as unknown as Grip<any>)
    ) {
      throw new Error("Cannot set the self/handle grip value");
    }
    if (!this.values.has(grip as unknown as Values<Outs>)) {
      throw new Error("Cannot set value for non-provided grip on MultiAtomValueTap");
    }
    const key = grip as unknown as Values<Outs>;
    const prev = this.values.get(key) as GripValue<Outs[K]> | undefined;
    if (prev !== nextValue) {
      this.values.set(key, nextValue);
      this.produce({ changed: grip as unknown as Grip<any> });
    }
  }
}

/**
 * Create a multi-value atom tap.
 *
 * Config semantics (equal priority):
 * - Tracked grips = union(config.grips, config.gripMap?.keys())
 * - Initialization per grip g:
 *   - if config.gripMap has g: use that value (even if undefined)
 *   - else if g is in config.grips: use g.defaultValue
 *   - else: leave undefined
 */
export function createMultiAtomValueTap<Outs extends GripRecord>(config: {
  grips?: ReadonlyArray<Values<Outs>>;
  gripMap?: Map<Values<Outs>, GripValue<Values<Outs>> | undefined>;
  handleGrip?: Grip<MultiAtomTapHandle<Outs>>;
}): MultiAtomValueTap<Outs> {
  const resolvedGrips: ReadonlyArray<Values<Outs>> =
    config.grips ?? Array.from(config.gripMap?.keys() ?? []);
  const tap = new MultiAtomValueTap<Outs>(resolvedGrips, config.gripMap, {
    handleGrip: config.handleGrip,
  });
  return tap;
}
