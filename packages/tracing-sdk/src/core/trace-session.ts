import { v4 as uuidv4 } from 'uuid';
import type { TracingHttpClient } from '../client/tracing-http-client';
import type { FlushWorker } from './flush-worker';
import type {
  StepType,
  TokenUsage,
  AddStepPayload,
  CompleteTracePayload,
  FailTracePayload,
} from '../types';

export type TraceSessionOptions = {
  traceId: string;
  client: TracingHttpClient;
  worker: FlushWorker;
  failSilently: boolean;
};

/**
 * Represents an active trace session.
 * All mutations are enqueued to the FlushWorker — never blocking.
 */
export class TraceSession {
  private sequenceCounter = 0;
  private traceId: string;

  constructor(private readonly options: TraceSessionOptions) {
    this.traceId = options.traceId;
    this.addStep = this.addStep.bind(this);
    this.addLlmStep = this.addLlmStep.bind(this);
    this.addToolStep = this.addToolStep.bind(this);
    this.addRetrievalStep = this.addRetrievalStep.bind(this);
    this.complete = this.complete.bind(this);
    this.fail = this.fail.bind(this);
  }

  get id(): string {
    return this.traceId;
  }

  /**
   * Manually add a step to the running trace.
   * Non-blocking — enqueued to background worker.
   */
  addStep(payload: AddStepPayload): void {
    const stepPayload = {
      ...payload,
      latencyMs: Math.round(payload.latencyMs),
    };
    this.options.worker.enqueue(() =>
      this.options.client.addStep(this.traceId, stepPayload).then(() => void 0),
    );
    this.sequenceCounter++;
  }

  /**
   * Record an LLM call step. Measures latency automatically if
   * startedAt/endedAt are provided; otherwise infers from latencyMs.
   */
  addLlmStep(params: {
    name: string;
    input: unknown;
    output: unknown;
    tokenUsage?: TokenUsage | null;
    error?: string | null;
    latencyMs: number;
    startedAt: Date;
    endedAt: Date;
    metadata?: Record<string, unknown>;
  }): void {
    this.addStep({ type: 'llm_call', ...params });
  }

  addToolStep(params: {
    name: string;
    input: unknown;
    output: unknown;
    error?: string | null;
    latencyMs: number;
    startedAt: Date;
    endedAt: Date;
    metadata?: Record<string, unknown>;
    artifacts?: AddStepPayload['artifacts'];
  }): void {
    this.addStep({ type: 'tool_call', ...params });
  }

  addRetrievalStep(params: {
    name: string;
    input: unknown;
    output: unknown;
    error?: string | null;
    latencyMs: number;
    startedAt: Date;
    endedAt: Date;
    metadata?: Record<string, unknown>;
  }): void {
    this.addStep({ type: 'retrieval', ...params });
  }

  /** Mark trace as completed. Non-blocking. */
  complete(payload: CompleteTracePayload): void {
    this.options.worker.enqueue(() =>
      this.options.client
        .completeTrace(this.traceId, payload)
        .then(() => void 0),
    );
  }

  /** Mark trace as failed. Non-blocking. */
  fail(payload: FailTracePayload): void {
    this.options.worker.enqueue(() =>
      this.options.client
        .failTrace(this.traceId, payload)
        .then(() => void 0),
    );
  }
}

// ─── Timing helper ────────────────────────────────────────────────────────────

export type TimedResult<T> = {
  result: T;
  latencyMs: number;
  startedAt: Date;
  endedAt: Date;
};

export async function timed<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
  const startedAt = new Date();
  const start = Date.now();
  const result = await fn();
  const endedAt = new Date();
  return {
    result,
    latencyMs: Date.now() - start,
    startedAt,
    endedAt,
  };
}

export function newStepId(): string {
  return uuidv4();
}
