import { withRetry } from './retry';

export type FlushableOperation = () => Promise<void>;

/**
 * Non-blocking background worker that batches and flushes async operations.
 * Operations added via enqueue() are executed in FIFO order.
 * Flushes either when maxQueueSize is reached or on a fixed interval.
 */
export class FlushWorker {
  private queue: FlushableOperation[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private readonly maxQueueSize: number,
    private readonly flushIntervalMs: number,
    private readonly maxRetries: number,
    private readonly retryBaseDelayMs: number,
    private readonly failSilently: boolean,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(operation: FlushableOperation): void {
    this.queue.push(operation);
    if (this.queue.length >= this.maxQueueSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    const batch = this.queue.splice(0, this.queue.length);
    try {
      for (const operation of batch) {
        await withRetry(
          operation,
          this.maxRetries,
          this.retryBaseDelayMs,
        ).catch((err) => {
          if (!this.failSilently) throw err;
          // silently swallow the error — tracing must never break the app
        });
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Force drain everything remaining. Call before process exit. */
  async drain(): Promise<void> {
    this.stop();
    await this.flush();
  }
}
