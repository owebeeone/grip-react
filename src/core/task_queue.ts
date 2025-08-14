// A small, self-contained, extensible task queue with priority ordering and
// support for weakly-held callbacks. Lower numeric priority runs first.
//
// Design goals:
// - Stable ordering for tasks with equal priority (FIFO for same priority)
// - Auto-flush on next microtask by default; optionally manual flush
// - Weak submission drops tasks if callback is GC'd before execution
// - Cancellation support via returned handle
// - No external dependencies; idiomatic TypeScript

export type TaskCallback = () => void;

export interface TaskHandle {
  cancel(): boolean;
  isRunning(): boolean;
  isCancelled(): boolean;
  isPending(): boolean;
  isCompleted(): boolean;
}

/**
 * Interface for a container for TaskHandles.
 */
export interface TaskHandleContainer {
  add(handle: TaskHandle): void;
  remove(handle: TaskHandle): void;
}

/**
 * A container for TaskHandles implementing the TaskHandleContainer interface.
 */
export class TaskHandleHolder implements TaskHandleContainer {
  private readonly handles: TaskHandle[] = [];
  add(handle: TaskHandle): void {
    this.handles.push(handle);
  }
  remove(handle: TaskHandle): void {
    const idx = this.handles.indexOf(handle);
    if (idx >= 0) this.handles.splice(idx, 1);
  }
  getHandles(): ReadonlyArray<TaskHandle> { return this.handles; }
  get size(): number { return this.handles.length; }
  cancelAll(): void {
    while (this.handles.length > 0) {
        this.handles[0].cancel();
    }
  }
}

/**
 * Options for the TaskQueue.
 */
export interface TaskQueueOptions {
  // When true (default), a flush is scheduled automatically on submit.
  autoFlush?: boolean;
  // When true (default), use queueMicrotask; otherwise falls back to setTimeout(0).
  useMicrotask?: boolean;
}

/**
 * The state of a task.
 */
type TaskState = "pending" | "running" | "completed" | "cancelled";

// Internal representation of a task.
interface InternalTask {
  id: number;
  priority: number;
  // Stable tie-breaker to preserve FIFO for equal priority
  sequence: number;
  // Exactly one of these is set
  strongCallback?: TaskCallback;
  weakCallback?: WeakRef<TaskCallback>;
  state: TaskState;
  handle?: TaskHandleImpl;
}

/**
 * A minimal priority queue using a binary min-heap keyed by (priority, sequence).
 * Stable for tasks with the same priority.
 */
class MinHeap {
  private items: InternalTask[] = [];

  get size(): number { return this.items.length; }

  push(task: InternalTask): void {
    this.items.push(task);
    this.bubbleUp(this.items.length - 1);
  }

  peek(): InternalTask | undefined {
    return this.items[0];
  }

  pop(): InternalTask | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const end = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = end;
      this.bubbleDown(0);
    }
    return top;
  }

  private less(a: InternalTask, b: InternalTask): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.sequence < b.sequence;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.less(this.items[index], this.items[parent])) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.items.length;
    while (true) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let smallest = index;
      if (left < length && this.less(this.items[left], this.items[smallest])) {
        smallest = left;
      }
      if (right < length && this.less(this.items[right], this.items[smallest])) {
        smallest = right;
      }
      if (smallest === index) break;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const tmp = this.items[i];
    this.items[i] = this.items[j];
    this.items[j] = tmp;
  }
}

/**
 * A task queue.
 *
 * The TaskQueue is a priority queue for tasks.
 */
export class TaskQueue {
  private readonly heap: MinHeap = new MinHeap();
  private readonly options: Required<TaskQueueOptions>;
  private nextId = 1;
  private nextSequence = 1;
  private scheduled: boolean = false;
  private isFlushing: boolean = false;

  constructor(options?: TaskQueueOptions) {
    this.options = {
      autoFlush: options?.autoFlush ?? true,
      useMicrotask: options?.useMicrotask ?? true,
    };
  }

  /** Number of tasks currently queued (including cancelled/unresolvable weak tasks). */
  get size(): number { return this.heap.size; }

  /**
   * Submit a task with an optional priority (default 0). Lower numbers run first.
   * If a holder is provided, a handle is created and stored there; otherwise no handle is created.
   */
  submit(callback: TaskCallback, priority: number = 0, holder?: TaskHandleContainer): void {
    const task: InternalTask = {
      id: this.nextId++,
      priority,
      sequence: this.nextSequence++,
      strongCallback: callback,
      state: "pending",
    };
    if (holder) {
        task.handle = this.createHandle(task, holder);
    }
    this.heap.push(task);
    this.scheduleFlushIfNeeded();
  }

  /**
   * Submit a task held via WeakRef. If the callback is GC'd before execution,
   * the task is dropped silently.
   *
   * If WeakRef is not available in the runtime, this falls back to a strong
   * submission to preserve functionality.
   */
  submitWeak(callback: TaskCallback, priority: number = 0, holder?: TaskHandleContainer): void {
    if (typeof WeakRef === "undefined") {
      // Fallback: no WeakRef support, degrade to strong reference
      this.submit(callback, priority, holder);
      return;
    }
    const task: InternalTask = {
      id: this.nextId++,
      priority,
      sequence: this.nextSequence++,
      weakCallback: new WeakRef(callback),
      state: "pending",
    };
    if (holder) {
        task.handle = this.createHandle(task, holder);
    }
    this.heap.push(task);
    this.scheduleFlushIfNeeded();
  }

  /** Execute all queued tasks immediately in priority order. */
  flush(): void {
    if (this.isFlushing) return; // Prevent re-entrant flush cycles
    this.isFlushing = true;
    try {
      // Process until we exhaust the heap
      while (true) {
        const task = this.heap.pop();
        if (!task) break;
        if (task.state === "cancelled") continue;

        const fn = task.strongCallback ?? task.weakCallback?.deref();
        if (!fn) {
          // Weak callback GC'd; drop the task as completed (no-op)
          if (task.state === "pending") task.handle?.notifyNoLongerPending();
          task.state = "completed";
          continue;
        }

        try {
          if (task.state === "pending") task.handle?.notifyNoLongerPending();
          task.state = "running";
          fn();
          task.state = "completed";
        } catch (err) {
          // Surface errors asynchronously to avoid breaking the flush loop
          // while still being observable by the host environment.
          this.reportAsyncError(err);
          // Mark as completed even if it threw; the task has finished its turn
          task.state = "completed";
        }
      }
    } finally {
      this.isFlushing = false;
      this.scheduled = false;
    }
  }

  /** Cancel any scheduled but not-yet-executed auto-flush. */
  cancelScheduledFlush(): void {
    // No external timer handle because we rely on queueMicrotask/setTimeout
    // which cannot be unscheduled without a handle. We simply mark as not
    // scheduled when appropriate. If a microtask is already enqueued it will
    // execute, but the guard at the start of flush() prevents re-entrancy.
    this.scheduled = false;
  }

  private createHandle(task: InternalTask, holder: TaskHandleContainer): TaskHandleImpl {
    const handle = new TaskHandleImpl(task, holder);
    holder.add(handle);
    return handle;
  }

  private scheduleFlushIfNeeded(): void {
    if (!this.options.autoFlush) return;
    if (this.scheduled || this.isFlushing) return;
    this.scheduled = true;
    if (this.options.useMicrotask && typeof queueMicrotask === "function") {
      queueMicrotask(() => this.flush());
    } else {
      setTimeout(() => this.flush(), 0);
    }
  }

  private reportAsyncError(error: unknown): void {
    // Best-effort async error reporting without throwing inside the flush loop
    setTimeout(() => { throw error; }, 0);
  }
}

/**
 * A task handle.
 * 
 * Represents the queued task.
 */
class TaskHandleImpl implements TaskHandle {
  private readonly task: InternalTask;
  private readonly holder: TaskHandleContainer;
  private removed = false;

  constructor(task: InternalTask, holder: TaskHandleContainer) {
    this.task = task;
    this.holder = holder;
  }

  cancel(): boolean {
    if (this.task.state !== "pending") return false;
    this.task.state = "cancelled";
    this.notifyNoLongerPending();
    return true;
  }

  isRunning(): boolean { return this.task.state === "running"; }
  isCancelled(): boolean { return this.task.state === "cancelled"; }
  isPending(): boolean { return this.task.state === "pending"; }
  isCompleted(): boolean { return this.task.state === "completed"; }

  notifyNoLongerPending(): void {
    if (this.removed) return;
    try { this.holder.remove(this); } finally { this.removed = true; }
  }
}

