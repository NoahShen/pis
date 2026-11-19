import { BoundedTaskQueue } from "./bounded-task-queue.js";

export interface StageWorkerOptions<T> {
  readonly queue: BoundedTaskQueue<T>;
  readonly handle: (task: T) => void | Promise<void>;
  readonly onError?: (error: unknown) => void | PromiseLike<void>;
}

export class StageWorker<T> {
  private readonly options: StageWorkerOptions<T>;
  private runPromise: Promise<void> | undefined;

  constructor(options: StageWorkerOptions<T>) {
    this.options = options;
  }

  start(): void {
    this.ensureStarted();
  }

  async done(): Promise<void> {
    await this.ensureStarted();
  }

  private ensureStarted(): Promise<void> {
    if (this.runPromise === undefined) {
      this.runPromise = this.run();
    }

    return this.runPromise;
  }

  private async run(): Promise<void> {
    while (true) {
      const task = await this.options.queue.dequeue();

      if (task === null) {
        return;
      }

      try {
        await this.options.handle(task);
      } catch (error) {
        await this.reportError(error);
      }
    }
  }

  private async reportError(error: unknown): Promise<void> {
    const onError = this.options.onError;

    if (onError === undefined) {
      return;
    }

    try {
      await onError(error);
    } catch {
      // Error reporting is best-effort and must not stop the worker loop.
    }
  }
}
