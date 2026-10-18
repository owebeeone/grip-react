import React, { useEffect, useRef } from "react";

/** Keep row identity stable; animate only a changed display value, never a refresh. */
export function GraphValueRow({ value, baseline, children, ...attributes }: {
  value: string;
  baseline: object;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const element = useRef<HTMLDivElement>(null);
  const previous = useRef({ value, baseline });
  useEffect(() => {
    const changed = previous.current.baseline === baseline && previous.current.value !== value;
    previous.current = { value, baseline };
    if (!changed || !element.current?.animate) {
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const active = { backgroundColor: "#0759c7", color: "#ffffff", boxShadow: "0 0 0 2px #003b8e, 0 0 0 4px #ffcf33" };
    const clear = { backgroundColor: "transparent", color: "#213547", boxShadow: "0 0 0 2px transparent, 0 0 0 4px transparent" };
    const animation = element.current.animate([
      { ...active, offset: 0, easing: "steps(1, end)" },
      { ...active, ...(reduced ? {} : { backgroundColor: "#dbeafe", color: "#213547" }), offset: 0.3 },
      { ...(reduced ? active : clear), offset: 1 },
    ], { duration: 1500, easing: "linear" });
    return () => { animation.cancel(); };
  }, [value, baseline]);
  return <div {...attributes} ref={element}>{children}</div>;
}
