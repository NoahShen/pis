export interface BoundedTaskQueueOptions {
  readonly capacity?: number;
  readonly signal?: AbortSignal;
}

export class QueueClosedError extends Error {
  readonly code = "queue_closed";

  constructor() {
    super("Queue is closed");
    this.name = "QueueClosedError";
  }
}

interface EnqueueWaiter<T> {
  readonly task: T;
  readonly resolve: () => void;
  readonly reject: (error: QueueClosedError) => void;
}

interface DequeueWaiter<T> {
  readonly resolve: (task: T | null) => void;
}

const DEFAULT_CAPACITY = 8;

function validateCapacity(capacity: number): void {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError("capacity must be a positive integer");
  }
}

export class BoundedTaskQueue<T> {
  private readonly capacity: number;
  private readonly signal?: AbortSignal;
  private readonly tasks: T[] = [];
  private readonly enqueueWaiters: EnqueueWaiter<T>[] = [];
  private readonly dequeueWaiters: DequeueWaiter<T>[] = [];
  private closed = false;
  private readonly handleAbort = (): void => {
    this.close();
  };

  constructor(options: BoundedTaskQueueOptions = {}) {
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    validateCapacity(capacity);

    this.capacity = capacity;
    this.signal = options.signal;

    if (this.signal?.aborted === true) {
      this.closed = true;
      return;
    }

    this.signal?.addEventListener("abort", this.handleAbort, { once: true });
  }

  get size(): number {
    return this.tasks.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  enqueue(task: T): Promise<void> {
    if (this.closed) {
      return Promise.reject(new QueueClosedError());
    }

    return new Promise<void>((resolve, reject) => {
      this.enqueueWaiters.push({ task, resolve, reject });
      this.pump();
    });
  }

  dequeue(): Promise<T | null> {
    if (this.tasks.length > 0) {
      const task = this.tasks.shift()!;
      this.pump();
      return Promise.resolve(task);
    }

    if (this.closed) {
      return Promise.resolve(null);
    }

    return new Promise<T | null>((resolve) => {
      this.dequeueWaiters.push({ resolve });
      this.pump();
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.signal?.removeEventListener("abort", this.handleAbort);

    for (const waiter of this.enqueueWaiters.splice(0)) {
      waiter.reject(new QueueClosedError());
    }

    for (const waiter of this.dequeueWaiters.splice(0)) {
      waiter.resolve(null);
    }
  }

  private pump(): void {
    while (this.tasks.length > 0 && this.dequeueWaiters.length > 0) {
      const task = this.tasks.shift()!;
      const waiter = this.dequeueWaiters.shift()!;
      waiter.resolve(task);
    }

    while (this.enqueueWaiters.length > 0) {
      const waiter = this.enqueueWaiters[0]!;
      const dequeueWaiter = this.dequeueWaiters.shift();

      if (dequeueWaiter !== undefined) {
        this.enqueueWaiters.shift();
        dequeueWaiter.resolve(waiter.task);
        waiter.resolve();
        continue;
      }

      if (this.tasks.length >= this.capacity) {
        return;
      }

      this.enqueueWaiters.shift();
      this.tasks.push(waiter.task);
      waiter.resolve();
    }
  }
}
