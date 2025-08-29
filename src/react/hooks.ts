import { useSyncExternalStore, useMemo, useEffect, useCallback } from "react";
import type React from "react";
import { Grip } from "../core/grip";
import { GripContext, GripContextLike } from "../core/context";
import { useRuntime } from "./provider";
import { Tap } from "../core/tap";
import { createAtomValueTap, AtomTap, AtomTapHandle } from "../core/atom_tap";

// Overload 1: When initial value is provided and is non-nullable, return AtomTap with non-nullable type
export function useAtomValueTap<TGrip>(
  grip: Grip<TGrip | undefined>,
  opts: {
    ctx?: GripContext;
    initial: NonNullable<TGrip>;
    tapGrip?: Grip<AtomTapHandle<NonNullable<TGrip>>>;
  },
): AtomTap<NonNullable<TGrip>>;

// Overload 2: Standard case - return AtomTap with original grip type
export function useAtomValueTap<TGrip>(
  grip: Grip<TGrip>,
  opts?: {
    ctx?: GripContext;
    initial?: TGrip;
    tapGrip?: Grip<AtomTapHandle<TGrip>>;
  },
): AtomTap<TGrip>;

// Implementation
export function useAtomValueTap<TGrip>(
  grip: Grip<TGrip>,
  opts?: {
    ctx?: GripContext;
    initial?: TGrip;
    tapGrip?: Grip<AtomTapHandle<TGrip>>;
  },
): AtomTap<TGrip> {
  const tap = useMemo(
    () => createAtomValueTap(grip, { initial: opts?.initial, handleGrip: opts?.tapGrip }),
    [grip, opts?.initial, opts?.tapGrip],
  );
  useTap(() => tap, { ctx: opts?.ctx, deps: [tap] });
  const get = useCallback(() => tap, [tap]);
  return useSyncExternalStore((notify) => (tap as any).subscribe(notify), get, get);
}

// useGrip(grip, [ctx]) -> value (reactive)
export function useGrip<T>(grip: Grip<T>, ctx?: GripContext | GripContextLike): T | undefined {
  const { grok, context: providerCtx } = useRuntime();
  const activeCtx =
    ctx && (ctx as any).getGripConsumerContext
      ? (ctx as GripContextLike).getGripConsumerContext()
      : ((ctx as GripContext | undefined) ?? providerCtx);

  // Get (and memoize) the Drip for this grip+ctx
  const drip = useMemo(() => grok.query(grip, activeCtx), [grok, activeCtx, grip]);

  // Subscribe via useSyncExternalStore with memoized callbacks
  const get = useCallback(() => drip.get(), [drip]);
  const subscribe = useCallback((notify: () => void) => drip.subscribe(() => notify()), [drip]);
  return useSyncExternalStore(subscribe, get, get);
}


export function useTap(
  factory: () => Tap,
  opts?: { ctx?: GripContext; deps?: React.DependencyList }, // deps to control re-creation
): void {
  const { context: providerCtx } = useRuntime();
  const ctx = opts?.ctx ?? providerCtx;
  const tap = useMemo(factory, opts?.deps ?? [ctx]); // default: recreate only when ctx changes

  useEffect(() => {
    ctx.getGripHomeContext().registerTap(tap);
    return () => {
      ctx.getGripHomeContext().unregisterTap(tap);
    };
  }, [ctx, tap]);
}

/**
 * useGripSetter
 * Returns a stable setter for an AtomTap handle. No-ops if the handle isn't available yet.
 *
 * Example:
 * const setLocation = useGripSetter(WEATHER_LOCATION_TAP);
 * <select onChange={e => setLocation(e.target.value)} />
 */
export function useGripSetter<T>(
  tapGrip: Grip<AtomTapHandle<T>>,
  ctx?: GripContext | GripContextLike,
): (v: T | undefined | ((prev: T | undefined) => T | undefined)) => void {
  const handle = useGrip(tapGrip, ctx);
  return useCallback(
    (v: T | undefined | ((prev: T | undefined) => T | undefined)) => {
      (handle as any)?.set(v as any);
    },
    [handle],
  );
}

/**
 * useGripState
 * React-style API returning [value, setValue] for a Grip controlled by an AtomTap.
 *
 * Example:
 * const [value, setValue] = useGripState(WEATHER_LOCATION, WEATHER_LOCATION_TAP);
 * <input value={value ?? ''} onChange={e => setValue(e.target.value)} />
 */
export function useGripState<T>(
  grip: Grip<T>,
  tapGrip: Grip<AtomTapHandle<T>>,
  ctx?: GripContext | GripContextLike,
): [T | undefined, (v: T | undefined | ((prev: T | undefined) => T | undefined)) => void] {
  const value = useGrip(grip, ctx);
  const setValue = useGripSetter(tapGrip, ctx);
  return [value, setValue];
}

/**
 * useTextGrip
 * Binding for input[type=text|email|url|tel|search] and textarea.
 *
 * Example:
 * const bind = useTextGrip(NAME, NAME_TAP);
 * <input type="text" {...bind} />
 */
export function useTextGrip<T = string>(
  grip: Grip<T>,
  tapGrip: Grip<AtomTapHandle<T>>,
  opts?: {
    ctx?: GripContext | GripContextLike;
    parse?: (s: string) => T | undefined;
    format?: (v: T | undefined) => string;
  },
): {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
} {
  const { ctx, parse, format } = opts ?? {};
  const value = useGrip(grip, ctx);
  const setValue = useGripSetter(tapGrip, ctx);
  const uiValue = (format ? format(value) : (value as unknown as string | undefined)) ?? "";
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const s = e.target.value;
      setValue(parse ? parse(s) : (s as unknown as T));
    },
    [setValue, parse],
  );
  return { value: uiValue, onChange };
}

/**
 * useNumberGrip
 * Binding for input[type=number|range]. Handles empty string and optional clamping.
 *
 * Example:
 * const bind = useNumberGrip(AGE, AGE_TAP);
 * <input type="number" {...bind} />
 */
export function useNumberGrip(
  grip: Grip<number>,
  tapGrip: Grip<AtomTapHandle<number>>,
  opts?: {
    ctx?: GripContext | GripContextLike;
    emptyAs?: number | undefined; // default: undefined
    clamp?: { min?: number; max?: number };
    parse?: (s: string) => number | undefined;
    format?: (v: number | undefined) => string;
  },
): { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void } {
  const { ctx, emptyAs, clamp, parse, format } = opts ?? {};
  const value = useGrip(grip, ctx);
  const setValue = useGripSetter(tapGrip, ctx);
  const applyClamp = useCallback(
    (n: number | undefined) => {
      if (n == null) return n;
      let x = n;
      if (clamp?.min != null && x < clamp.min) x = clamp.min;
      if (clamp?.max != null && x > clamp.max) x = clamp.max;
      return x;
    },
    [clamp?.min, clamp?.max],
  );
  const defaultParse = useCallback(
    (s: string) => {
      if (s === "") return emptyAs ?? undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : (emptyAs ?? undefined);
    },
    [emptyAs],
  );
  const uiValue = format ? format(value) : value == null ? "" : String(value);
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const s = e.target.value;
      const n = (parse ?? defaultParse)(s);
      setValue(applyClamp(n));
    },
    [setValue, parse, defaultParse, applyClamp],
  );
  return { value: uiValue, onChange };
}

/**
 * useSelectGrip
 * Binding for <select> elements.
 *
 * Example:
 * const bind = useSelectGrip(WEATHER_LOCATION, WEATHER_LOCATION_TAP);
 * <select {...bind} />
 */
export function useSelectGrip<T = string>(
  grip: Grip<T>,
  tapGrip: Grip<AtomTapHandle<T>>,
  opts?: {
    ctx?: GripContext | GripContextLike;
    parse?: (s: string) => T | undefined;
    format?: (v: T | undefined) => string;
  },
): { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void } {
  const { ctx, parse, format } = opts ?? {};
  const value = useGrip(grip, ctx);
  const setValue = useGripSetter(tapGrip, ctx);
  const uiValue = (format ? format(value) : (value as unknown as string | undefined)) ?? "";
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const s = e.target.value;
      setValue(parse ? parse(s) : (s as unknown as T));
    },
    [setValue, parse],
  );
  return { value: uiValue, onChange };
}

/**
 * useCheckboxGrip
 * Binding for input[type=checkbox]. Maps to boolean or custom true/false values.
 *
 * Example (boolean):
 * const bind = useCheckboxGrip(ENABLED, ENABLED_TAP);
 * <input type="checkbox" {...bind} />
 *
 * Example (custom):
 * const bind = useCheckboxGrip(MODE, MODE_TAP, { trueValue: 'on', falseValue: 'off' });
 */
export function useCheckboxGrip<T = boolean>(
  grip: Grip<T>,
  tapGrip: Grip<AtomTapHandle<T>>,
  opts?: {
    ctx?: GripContext | GripContextLike;
    trueValue?: T;
    falseValue?: T;
  },
): { checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void } {
  const { ctx, trueValue, falseValue } = opts ?? {};
  const value = useGrip(grip, ctx);
  const setValue = useGripSetter(tapGrip, ctx);
  const checked =
    trueValue !== undefined || falseValue !== undefined
      ? value === trueValue
      : Boolean(value as unknown as boolean);
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextChecked = e.target.checked;
      if (trueValue !== undefined || falseValue !== undefined) {
        setValue(nextChecked ? (trueValue as T) : (falseValue as T));
      } else {
        setValue(nextChecked as unknown as T);
      }
    },
    [setValue, trueValue, falseValue],
  );
  return { checked, onChange };
}

/**
 * useRadioGrip
 * Binding for input[type=radio] options. Each option binds with its own optionValue.
 *
 * Example:
 * const apple = useRadioGrip(FRUIT, FRUIT_TAP, 'apple');
 * const banana = useRadioGrip(FRUIT, FRUIT_TAP, 'banana');
 * <input type="radio" name="fruit" {...apple} />
 * <input type="radio" name="fruit" {...banana} />
 */
export function useRadioGrip<T>(
  grip: Grip<T>,
  tapGrip: Grip<AtomTapHandle<T>>,
  optionValue: T,
  opts?: { ctx?: GripContext | GripContextLike; toString?: (v: T) => string },
): { checked: boolean; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void } {
  const { ctx, toString } = opts ?? {};
  const value = useGrip(grip, ctx);
  const setValue = useGripSetter(tapGrip, ctx);
  const checked = value === optionValue;
  const stringValue = (toString ?? ((v: T) => String(v)))(optionValue);
  const onChange = useCallback(() => setValue(optionValue), [setValue, optionValue]);
  return { checked, value: stringValue, onChange };
}
