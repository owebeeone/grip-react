/**
 * GRIP React Integration - Hooks for declarative data management
 * 
 * This module provides React hooks that enable seamless integration between
 * React components and the GRIP reactive dataflow system. These hooks allow
 * components to declaratively request data by Grip keys and automatically
 * receive updates when data changes.
 * 
 * Key Features:
 * - Declarative data requests via Grips
 * - Automatic reactivity and re-rendering
 * - Form binding utilities for common input types
 * - Context-aware data resolution
 * - Type-safe data access and updates
 * 
 * Core Hooks:
 * - useGrip: Read reactive values from Grips
 * - useTap: Register data producers (Taps)
 * - useAtomValueTap: Create and manage atom-style state
 * - useGripSetter: Get stable setters for atom handles
 * - useGripState: React-style [value, setValue] pattern
 * 
 * Form Binding Hooks:
 * - useTextGrip: Text inputs and textareas
 * - useNumberGrip: Number inputs with validation
 * - useSelectGrip: Select dropdowns
 * - useCheckboxGrip: Checkbox inputs
 * - useRadioGrip: Radio button groups
 */

import { useSyncExternalStore, useMemo, useEffect, useCallback } from "react";
import type React from "react";
import { Grip } from "../core/grip";
import { GripContext, GripContextLike } from "../core/context";
import { useRuntime } from "./provider";
import { Tap } from "../core/tap";
import { createAtomValueTap, AtomTap, AtomTapHandle } from "../core/atom_tap";

/**
 * Creates and manages an atom-style Tap for reactive state management.
 * 
 * This hook creates an AtomValueTap that provides a specific Grip and returns
 * a controller interface for reading and writing values. The Tap is automatically
 * registered with the GRIP system and will notify subscribers when values change.
 * 
 * The hook provides overloads to handle nullable vs non-nullable types appropriately.
 * When an initial value is provided and is non-nullable, the returned AtomTap will
 * have a non-nullable type.
 * 
 * @template TGrip - The type of value managed by this atom
 * @param grip - The Grip that this atom will provide
 * @param opts - Configuration options
 * @param opts.ctx - Optional context for the Tap (defaults to provider context)
 * @param opts.initial - Initial value for the atom
 * @param opts.tapGrip - Optional Grip for exposing the controller handle
 * @returns An AtomTap controller for reading and writing values
 * 
 * @example
 * ```tsx
 * const counter = useAtomValueTap(COUNTER_GRIP, { initial: 0 });
 * 
 * // Read value
 * const value = counter.get();
 * 
 * // Update value
 * counter.set(5);
 * counter.update(prev => prev + 1);
 * ```
 */

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

/**
 * Reads a reactive value from a Grip within a specific context.
 * 
 * This is the primary hook for consuming data in React components. It automatically
 * subscribes to the Grip's value and re-renders the component when the value changes.
 * The hook resolves the best data provider for the Grip based on the context hierarchy.
 * 
 * @template T - The type of value provided by the Grip
 * @param grip - The Grip to read the value from
 * @param ctx - Optional context for data resolution (defaults to provider context)
 * @returns The current value from the Grip, or undefined if not available
 * 
 * @example
 * ```tsx
 * const userName = useGrip(USER_NAME_GRIP);
 * const userAge = useGrip(USER_AGE_GRIP, userContext);
 * 
 * return <div>Hello {userName}, you are {userAge} years old</div>;
 * ```
 */
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

/**
 * Registers a Tap (data producer) with the GRIP system.
 * 
 * This hook manages the lifecycle of a Tap, automatically registering it when
 * the component mounts and unregistering it when the component unmounts or
 * dependencies change. The Tap factory function is called to create the Tap
 * instance, and the dependencies array controls when the Tap is recreated.
 * 
 * @param factory - Function that creates the Tap instance
 * @param opts - Configuration options
 * @param opts.ctx - Optional context for the Tap (defaults to provider context)
 * @param opts.deps - Dependencies array to control Tap recreation (defaults to [ctx])
 * 
 * @example
 * ```tsx
 * useTap(() => createWeatherTap(), { ctx: weatherContext });
 * 
 * // With dependencies
 * useTap(() => createUserTap(userId), { 
 *   ctx: userContext, 
 *   deps: [userId] 
 * });
 * ```
 */
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
 * Returns a stable setter function for an AtomTap handle.
 * 
 * This hook provides a convenient way to get a setter function that can update
 * values managed by an AtomTap. The setter is stable across re-renders and
 * safely handles cases where the handle isn't available yet.
 * 
 * @template T - The type of value managed by the AtomTap
 * @param tapGrip - The Grip that provides the AtomTap handle
 * @param ctx - Optional context for data resolution
 * @returns A setter function for the AtomTap handle
 * 
 * @example
 * ```tsx
 * const setLocation = useGripSetter(WEATHER_LOCATION_TAP);
 * 
 * return (
 *   <select onChange={e => setLocation(e.target.value)}>
 *     <option value="nyc">New York</option>
 *     <option value="london">London</option>
 *   </select>
 * );
 * ```
 */
export function useGripSetter<T>(
  tapGrip: Grip<AtomTapHandle<T>>,
  ctx?: GripContext | GripContextLike,
): (v: T) => void {
  const handle = useGrip(tapGrip, ctx);
  return useCallback(
    (v: T) => {
      if (handle) {
        handle.set(v);
      } else {
        console.warn(`useGripSetter: handle is undefined - no tap registered for: ${tapGrip.key}?`);
      }
    },
    [handle, tapGrip],
  );
}

/**
 * Returns a stable updater function for an AtomTap handle.
 * 
 * This hook provides a convenient way to get an updater function that can update
 * values managed by an AtomTap. The updater is stable across re-renders and
 * safely handles cases where the handle isn't available yet.
 * 
 * @template T - The type of value managed by the AtomTap
 * @param tapGrip - The Grip that provides the AtomTap handle
 * @param ctx - Optional context for data resolution
 * @returns An updater function for the AtomTap handle
 * 
 * @example
 * 
 * ```tsx
 * const updateCounter = useGripUpdater(COUNTER_GRIP);
 * 
 * return (
 *   <button onClick={() => updateCounter(prev => prev + 1)} />
 * );
 * ```
 */

export function useGripUpdater<T>(
  tapGrip: Grip<AtomTapHandle<T>>,
  ctx?: GripContext | GripContextLike,
): (func: (prev: T) => T) => void {
  const handle = useGrip(tapGrip, ctx);
  return useCallback(
    (func: (prev: T) => T) => {
      if (handle) {
        handle.update(func);
      } else {
        console.warn(`useGripUpdater: handle is undefined - no tap registered for: ${tapGrip.key}?`);
      }
    },
    [handle, tapGrip],
  );
}

/**
 * React-style API returning [value, setValue] for a Grip controlled by an AtomTap.
 * 
 * This hook combines useGrip and useGripSetter to provide a familiar React-style
 * state management pattern. It's ideal for form inputs and other interactive
 * components that need both reading and writing capabilities.
 * 
 * Notes:
 * - value is T | undefined (no value published yet or intentionally unset)
 * - setValue accepts a concrete value of type T (no updater function)
 * 
 * @template T - The type of value managed by the Grip
 * @param grip - The Grip to read values from
 * @param tapGrip - The Grip that provides the AtomTap handle for writing
 * @param ctx - Optional context for data resolution
 * @returns A tuple: [value: T | undefined, setValue: (v: T) => void]
 * 
 * @example
 * ```tsx
 * const [value, setValue] = useGripState(WEATHER_LOCATION, WEATHER_LOCATION_TAP);
 * 
 * return (
 *   <input 
 *     value={value ?? ''} 
 *     onChange={e => setValue(e.target.value)} 
 *   />
 * );
 * ```
 */
export function useGripState<T>(
  grip: Grip<T>,
  tapGrip: Grip<AtomTapHandle<T>>, 
  ctx?: GripContext | GripContextLike,
): [T | undefined, (v: T) => void] {
  const value = useGrip(grip, ctx);
  const setValue = useGripSetter(tapGrip, ctx);
  return [value, setValue];
}

/**
 * Binding for text inputs and textareas with optional parsing and formatting.
 * 
 * This hook provides a convenient way to bind text inputs to Grips with
 * automatic parsing and formatting. It handles the conversion between
 * string values (used by HTML inputs) and the Grip's value type.
 * 
 * @template T - The type of value managed by the Grip (defaults to string)
 * @param grip - The Grip to bind to
 * @param tapGrip - The Grip that provides the AtomTap handle
 * @param opts - Configuration options
 * @param opts.ctx - Optional context for data resolution
 * @param opts.parse - Function to parse string input to the Grip's type
 * @param opts.format - Function to format the Grip's value for display
 * @returns Object with value and onChange props for input elements
 * 
 * @example
 * ```tsx
 * const bind = useTextGrip(USER_NAME, USER_NAME_TAP);
 * 
 * return <input type="text" {...bind} placeholder="Enter name" />;
 * 
 * // With custom parsing
 * const bind = useTextGrip(USER_AGE, USER_AGE_TAP, {
 *   parse: (s) => parseInt(s, 10) || undefined,
 *   format: (n) => n?.toString() ?? ''
 * });
 * ```
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
      const next = parse ? parse(s) : (s as unknown as T);
      if (next !== undefined) {
        setValue(next);
      }
    },
    [setValue, parse],
  );
  return { value: uiValue, onChange };
}

/**
 * Binding for number inputs with validation, clamping, and empty value handling.
 * 
 * This hook provides comprehensive binding for number inputs, including
 * validation, range clamping, and handling of empty string inputs. It's
 * particularly useful for numeric form fields that need validation.
 * 
 * @param grip - The Grip to bind to (must be number type)
 * @param tapGrip - The Grip that provides the AtomTap handle
 * @param opts - Configuration options
 * @param opts.ctx - Optional context for data resolution
 * @param opts.emptyAs - Value to use when input is empty (default: undefined)
 * @param opts.clamp - Optional min/max values to clamp the input
 * @param opts.parse - Custom parsing function
 * @param opts.format - Custom formatting function
 * @returns Object with value and onChange props for number input elements
 * 
 * @example
 * ```tsx
 * const bind = useNumberGrip(USER_AGE, USER_AGE_TAP, {
 *   emptyAs: 0,
 *   clamp: { min: 0, max: 120 }
 * });
 * 
 * return <input type="number" {...bind} />;
 * ```
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
      const clamped = applyClamp(n);
      if (clamped == null) return; // cannot set undefined for Grip<number>
      setValue(clamped);
    },
    [setValue, parse, defaultParse, applyClamp],
  );
  return { value: uiValue, onChange };
}

/**
 * Binding for select dropdown elements with optional parsing and formatting.
 * 
 * This hook provides binding for select elements, handling the conversion
 * between string values (used by HTML select) and the Grip's value type.
 * 
 * @template T - The type of value managed by the Grip (defaults to string)
 * @param grip - The Grip to bind to
 * @param tapGrip - The Grip that provides the AtomTap handle
 * @param opts - Configuration options
 * @param opts.ctx - Optional context for data resolution
 * @param opts.parse - Function to parse string input to the Grip's type
 * @param opts.format - Function to format the Grip's value for display
 * @returns Object with value and onChange props for select elements
 * 
 * @example
 * ```tsx
 * const bind = useSelectGrip(WEATHER_LOCATION, WEATHER_LOCATION_TAP);
 * 
 * return (
 *   <select {...bind}>
 *     <option value="nyc">New York</option>
 *     <option value="london">London</option>
 *   </select>
 * );
 * ```
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
      const next = parse ? parse(s) : (s as unknown as T);
      if (next !== undefined) {
        setValue(next);
      }
    },
    [setValue, parse],
  );
  return { value: uiValue, onChange };
}

/**
 * Binding for checkbox inputs with boolean or custom true/false values.
 * 
 * This hook provides binding for checkbox inputs, supporting both standard
 * boolean values and custom true/false value mappings.
 * 
 * @template T - The type of value managed by the Grip (defaults to boolean)
 * @param grip - The Grip to bind to
 * @param tapGrip - The Grip that provides the AtomTap handle
 * @param opts - Configuration options
 * @param opts.ctx - Optional context for data resolution
 * @param opts.trueValue - Value to use when checkbox is checked
 * @param opts.falseValue - Value to use when checkbox is unchecked
 * @returns Object with checked and onChange props for checkbox elements
 * 
 * @example
 * ```tsx
 * // Boolean checkbox
 * const bind = useCheckboxGrip(ENABLED, ENABLED_TAP);
 * return <input type="checkbox" {...bind} />;
 * 
 * // Custom values
 * const bind = useCheckboxGrip(MODE, MODE_TAP, { 
 *   trueValue: 'on', 
 *   falseValue: 'off' 
 * });
 * ```
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
 * Binding for individual radio button options within a radio group.
 * 
 * This hook provides binding for individual radio buttons within a group.
 * Each radio button should use this hook with its specific option value.
 * The hook handles the comparison between the current Grip value and the
 * option value to determine if the radio button should be checked.
 * 
 * @template T - The type of value managed by the Grip
 * @param grip - The Grip to bind to
 * @param tapGrip - The Grip that provides the AtomTap handle
 * @param optionValue - The value this radio button represents
 * @param opts - Configuration options
 * @param opts.ctx - Optional context for data resolution
 * @param opts.toString - Function to convert the option value to a string
 * @returns Object with checked, value, and onChange props for radio elements
 * 
 * @example
 * ```tsx
 * const apple = useRadioGrip(FRUIT, FRUIT_TAP, 'apple');
 * const banana = useRadioGrip(FRUIT, FRUIT_TAP, 'banana');
 * 
 * return (
 *   <div>
 *     <input type="radio" name="fruit" {...apple} />
 *     <input type="radio" name="fruit" {...banana} />
 *   </div>
 * );
 * ```
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
