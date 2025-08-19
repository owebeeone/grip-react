import type { GripContext } from "./context";

export type Unsubscribe = () => void;

/**
 * A Drip is a value that can be subscribed to.
 * 
 * This is used by data consumers to get the latest value of a data source.
 * 
 * This is what is returned by the useGrip hook in react.
 */
export class Drip<T> {
  private context: GripContext | null = null; // Drips keep context alive.
  private value: T | undefined;
  private subs = new Set<(v: T | undefined) => void>();
  // TODO: Switch to using a higher priority task instead of immediate subscribers.
  private immediateSubs = new Set<(v: T | undefined) => void>();
  private firstSubCallbacks = new Set<() => void>();
  private zeroSubCallbacks = new Set<() => void>();
  private enqueued = false;
  private zeroCheckScheduled = false;

  constructor(context: GripContext, initial: T | undefined) {
    this.context = context;
    this.value = initial;
  }

  get(): T | undefined {
    return this.value;
  }

  /**
   * Set the value of the drip.
   *
   * If the new value is the same as the current value, subscribers are not notified.
   * 
   * This will enqueue a task to notify non immediate subscribers.
   * It will also notify immediate subscribers directly.
   */
  next(v: T | undefined): void {
    if (this.value !== v) {
      this.value = v;
      this.enqueueNotifySubscribers();
    }
  }

  /**
   * Enqueue a task to notify subscribers.
   * 
   * This will notify immediate subscribers directly.
   * It will also enqueue a task to notify non immediate subscribers.
   */
  enqueueNotifySubscribers(): void {
    this.notifyImmediateSubscribers();
    if (!this.enqueued) {
      this.enqueued = true;
      const self = this;
      this.context?.submitWeakTask(() => self.taskQueueCallback());
    }
  }

  private taskQueueCallback(): void {
    this.enqueued = false;
    this.notifySubscribers();
  }

  notifySubscribers(): void {
    this.subs.forEach(fn => fn(this.value));
  }
  
  notifyImmediateSubscribers(): void {
    this.immediateSubs.forEach(fn => fn(this.value));
  }

  hasSubscribers(): boolean {
    return this.subs.size > 0 || this.immediateSubs.size > 0;
  }

  subscribeWith(queue: Set<(v: T | undefined) => void>, fn: (v: T | undefined) => void): Unsubscribe {
    const wasEmpty = ! this.hasSubscribers();
    queue.add(fn);
    if (wasEmpty) {
      this.firstSubCallbacks.forEach(cb => cb());
    }
    return () => {
      if (queue.has(fn)) {
        queue.delete(fn);
        // Defer zero-subscriber cleanup to allow transient resubscribe patterns
        if (!this.hasSubscribers() && !this.zeroCheckScheduled) {
          this.zeroCheckScheduled = true;
          const self = this;
          this.context?.submitWeakTask(() => {
            self.zeroCheckScheduled = false;
            if (!self.hasSubscribers()) {
              self.zeroSubCallbacks.forEach(cb => cb());
            }
          });
        }
      }
    };
  }

  subscribe(fn: (v: T | undefined) => void): Unsubscribe {
    return this.subscribeWith(this.subs, fn);
  }

  subscribePriority(fn: (v: T | undefined) => void): Unsubscribe {
    return this.subscribeWith(this.immediateSubs, fn);
  }

  addOnFirstSubscriber(fn: () => void): void {
    this.firstSubCallbacks.add(fn);
  }

  addOnZeroSubscribers(fn: () => void): void {
    this.zeroSubCallbacks.add(fn);
  }

  unsubscribeAll(): void {
    if (this.hasSubscribers()) {
      this.subs.clear();
      this.immediateSubs.clear();
      this.zeroSubCallbacks.forEach(cb => cb());
    }
    this.context = null;
  }

  // Intended for internal use by managed unsubscribe wrappers
  _notifyUnsubscribed(): void {
    if (this.subs.size === 0 && !this.zeroCheckScheduled) {
      this.zeroCheckScheduled = true;
      const self = this;
      this.context?.submitWeakTask(() => {
        self.zeroCheckScheduled = false;
        if (!self.hasSubscribers()) {
          self.zeroSubCallbacks.forEach(cb => cb());
        }
      });
    }
  }
}
