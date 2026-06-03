import React from "react";
import type { AtomTapHandle, Grip, GripContext, GripContextLike } from "@owebeeone/grip-core";
import { useBufferedTextGrip, type BufferedTextGripUpdateMode } from "./hooks";

type TextGripProps<T> = {
  grip: Grip<T>;
  tapGrip: Grip<AtomTapHandle<T>>;
  ctx?: GripContext | GripContextLike;
  parse?: (s: string) => T | undefined;
  format?: (v: T | undefined) => string;
  update?: BufferedTextGripUpdateMode;
  warnOnMissingHandle?: boolean;
};

export type GripInputProps<T = string> =
  TextGripProps<T> &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue">;

export type GripTextareaProps<T = string> =
  TextGripProps<T> &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue">;

export function GripInput<T = string>(props: GripInputProps<T>) {
  const {
    grip,
    tapGrip,
    ctx,
    parse,
    format,
    update,
    warnOnMissingHandle,
    onChange,
    onFocus,
    onBlur,
    ...inputProps
  } = props;
  const bind = useBufferedTextGrip(grip, tapGrip, { ctx, parse, format, update, warnOnMissingHandle });
  return (
    <input
      {...inputProps}
      value={bind.value}
      onChange={(e) => {
        bind.onChange(e);
        onChange?.(e);
      }}
      onFocus={(e) => {
        bind.onFocus(e);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        bind.onBlur(e);
        onBlur?.(e);
      }}
    />
  );
}

export function GripTextarea<T = string>(props: GripTextareaProps<T>) {
  const {
    grip,
    tapGrip,
    ctx,
    parse,
    format,
    update,
    warnOnMissingHandle,
    onChange,
    onFocus,
    onBlur,
    ...textareaProps
  } = props;
  const bind = useBufferedTextGrip(grip, tapGrip, { ctx, parse, format, update, warnOnMissingHandle });
  return (
    <textarea
      {...textareaProps}
      value={bind.value}
      onChange={(e) => {
        bind.onChange(e);
        onChange?.(e);
      }}
      onFocus={(e) => {
        bind.onFocus(e);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        bind.onBlur(e);
        onBlur?.(e);
      }}
    />
  );
}
