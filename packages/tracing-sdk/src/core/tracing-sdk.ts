import { TracingHttpClient } from '../client/tracing-http-client';
import { FlushWorker } from './flush-worker';
import { TraceSession } from './trace-session';
import type { TracingSdkConfig, CreateTracePayload } from '../types';

/**
 * Main entry point for the Tracing SDK.
 *
 * Usage:
 *   const sdk = new TracingSdk({ baseUrl: '...', apiKey: '...' });
 *   const session = await sdk.startTrace({ projectId, agentVersion, modelName, input });
 *   session.complete({ output });
 */
export class TracingSdk {
  private readonly client: TracingHttpClient;
  private readonly worker: FlushWorker;
  private readonly failSilently: boolean;

  constructor(private readonly config: TracingSdkConfig) {
    this.failSilently = config.failSilently ?? true;

    this.client = new TracingHttpClient(config.baseUrl, config.apiKey);

    this.worker = new FlushWorker(
      config.maxQueueSize ?? 50,
      config.flushIntervalMs ?? 2000,
      config.maxRetries ?? 3,
      config.retryBaseDelayMs ?? 200,
      this.failSilently,
    );

    this.worker.start();
  }

  /**
   * Start a new trace. Returns a TraceSession you use to add steps,
   * complete, or fail the trace.
   *
   * Non-blocking: creates the trace remotely (awaited) then all subsequent
   * operations are enqueued async.
   */
  async startTrace(payload: CreateTracePayload): Promise<TraceSession> {
    const guard = async (): Promise<TraceSession> => {
      const trace = await this.client.createTrace(payload);
      return new TraceSession({
        traceId: trace.id,
        client: this.client,
        worker: this.worker,
        failSilently: this.failSilently,
      });
    };

    if (this.failSilently) {
      try {
        return await guard();
      } catch {
        // Return a no-op session so the app continues unaffected
        return this.noopSession();
      }
    }

    return guard();
  }

  /**
   * Force flush all pending operations.
   * Call this before process exit to avoid data loss.
   */
  async flush(): Promise<void> {
    await this.worker.flush();
  }

  /** Flush and shut down the background worker. */
  async shutdown(): Promise<void> {
    await this.worker.drain();
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private noopSession(): TraceSession {
    return new TraceSession({
      traceId: 'noop',
      client: this.client,
      worker: {
        enqueue: () => void 0,
        flush: async () => void 0,
        drain: async () => void 0,
        start: () => void 0,
        stop: () => void 0,
      } as unknown as FlushWorker,
      failSilently: true,
    });
  }
}
