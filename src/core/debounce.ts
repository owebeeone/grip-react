export type Scheduler = (fn: () => void, ms: number) => any;

export function createDebouncer(ms: number, schedule: Scheduler = (fn, t) => setTimeout(fn, t)) {
  let timer: any | null = null;
  return (fn: () => void) => {
    if (ms <= 0) { fn(); return; }
    if (timer) { clearTimeout(timer); timer = null; }
    timer = schedule(fn, ms);
  };
}


