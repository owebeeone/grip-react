export type Unsubscribe = () => void;

export class Drip<T> {
  private value: T;
  private subs = new Set<(v: T) => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  next(v: T): void {
    this.value = v;
    this.subs.forEach(fn => fn(v));
  }

  subscribe(fn: (v: T) => void): Unsubscribe {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}
