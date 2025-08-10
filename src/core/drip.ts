export type Unsubscribe = () => void;

export class Drip<T> {
  private value: T;
  private subs = new Set<(v: T) => void>();
  private firstSubCallbacks = new Set<() => void>();
  private zeroSubCallbacks = new Set<() => void>();

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
    const wasEmpty = this.subs.size === 0;
    this.subs.add(fn);
    if (wasEmpty && this.subs.size === 1) {
      this.firstSubCallbacks.forEach(cb => cb());
    }
    return () => this.subs.delete(fn);
  }

  onFirstSubscriber(fn: () => void): void {
    this.firstSubCallbacks.add(fn);
  }

  onZeroSubscribers(fn: () => void): void {
    this.zeroSubCallbacks.add(fn);
  }

  // Intended for internal use by managed unsubscribe wrappers
  _notifyUnsubscribed(): void {
    if (this.subs.size === 0) {
      this.zeroSubCallbacks.forEach(cb => cb());
    }
  }
}
