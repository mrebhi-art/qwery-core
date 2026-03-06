import { v4 as uuidv4 } from 'uuid';

// ─── Value Objects ────────────────────────────────────────────────────────────

export type TraceId = string & { readonly __brand: 'TraceId' };
export type StepId = string & { readonly __brand: 'StepId' };

export function newTraceId(): TraceId {
  return uuidv4() as TraceId;
}

export function newStepId(): StepId {
  return uuidv4() as StepId;
}

// ─── Artifacts ───────────────────────────────────────────────────────────────

export type ArtifactType = 'table' | 'chart' | 'image' | 'sql' | 'text';

export type Artifact = {
  readonly name: string;
  readonly type: ArtifactType;
  readonly mimeType: string;   // e.g. 'text/csv', 'image/svg+xml', 'image/png', 'text/sql', 'application/json'
  readonly data: string;       // raw text for utf8 types, base64 for binary
  readonly encoding: 'utf8' | 'base64';
};

// ─── Enums ────────────────────────────────────────────────────────────────────

export type TraceStatus = 'running' | 'completed' | 'failed';
export type StepType =
  | 'llm_call'
  | 'tool_call'
  | 'retrieval'
  | 'reasoning'
  | 'custom';

// ─── Token Usage ──────────────────────────────────────────────────────────────

export type TokenUsage = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
};

// ─── Trace Step ───────────────────────────────────────────────────────────────

export type TraceStep = {
  readonly id: StepId;
  readonly traceId: TraceId;
  readonly sequence: number;
  readonly type: StepType;
  readonly name: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly error: string | null;
  readonly latencyMs: number;
  readonly tokenUsage: TokenUsage | null;
  readonly metadata: Record<string, unknown>;
  readonly artifacts: ReadonlyArray<Artifact>;
  readonly startedAt: Date;
  readonly endedAt: Date;
};

// ─── Trace ────────────────────────────────────────────────────────────────────

export type Trace = {
  readonly id: TraceId;
  readonly projectId: string;
  readonly agentVersion: string;
  readonly modelName: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly steps: ReadonlyArray<TraceStep>;
  readonly status: TraceStatus;
  readonly error: string | null;
  readonly totalLatencyMs: number;
  readonly totalTokenUsage: TokenUsage;
  readonly metadata: Record<string, unknown>;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  // SaaS multi-tenant isolation
  readonly apiKey: string;
};

// ─── Domain Factories ─────────────────────────────────────────────────────────

export type CreateTraceParams = {
  projectId: string;
  agentVersion: string;
  modelName: string;
  input: unknown;
  metadata?: Record<string, unknown>;
  apiKey: string;
};

export function createTrace(params: CreateTraceParams): Trace {
  return {
    id: newTraceId(),
    projectId: params.projectId,
    agentVersion: params.agentVersion,
    modelName: params.modelName,
    input: params.input,
    output: null,
    steps: [],
    status: 'running',
    error: null,
    totalLatencyMs: 0,
    totalTokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    metadata: params.metadata ?? {},
    startedAt: new Date(),
    endedAt: null,
    apiKey: params.apiKey,
  };
}

export type AddStepParams = {
  type: StepType;
  name: string;
  input: unknown;
  output: unknown;
  error?: string | null;
  latencyMs: number;
  tokenUsage?: TokenUsage | null;
  metadata?: Record<string, unknown>;
  artifacts?: Artifact[];
  startedAt: Date;
  endedAt: Date;
};

export function addStepToTrace(trace: Trace, params: AddStepParams): Trace {
  if (trace.status !== 'running') {
    throw new TraceDomainError(
      `Cannot add step to a trace with status "${trace.status}". Completed traces are immutable.`,
    );
  }

  const step: TraceStep = {
    id: newStepId(),
    traceId: trace.id,
    sequence: trace.steps.length,
    type: params.type,
    name: params.name,
    input: params.input,
    output: params.output,
    error: params.error ?? null,
    latencyMs: params.latencyMs,
    tokenUsage: params.tokenUsage ?? null,
    metadata: params.metadata ?? {},
    artifacts: params.artifacts ?? [],
    startedAt: params.startedAt,
    endedAt: params.endedAt,
  };

  const newTokenUsage = accumulateTokenUsage(
    trace.totalTokenUsage,
    params.tokenUsage ?? null,
  );

  return {
    ...trace,
    steps: [...trace.steps, step],
    totalTokenUsage: newTokenUsage,
  };
}

export type CompleteTraceParams = {
  output: unknown;
  metadata?: Record<string, unknown>;
};

export function completeTrace(
  trace: Trace,
  params: CompleteTraceParams,
): Trace {
  if (trace.status !== 'running') {
    throw new TraceDomainError(
      `Cannot complete a trace with status "${trace.status}".`,
    );
  }

  const endedAt = new Date();

  return {
    ...trace,
    output: params.output,
    status: 'completed',
    endedAt,
    totalLatencyMs: endedAt.getTime() - trace.startedAt.getTime(),
    metadata: { ...trace.metadata, ...(params.metadata ?? {}) },
  };
}

export type FailTraceParams = {
  error: string;
  metadata?: Record<string, unknown>;
};

export function failTrace(trace: Trace, params: FailTraceParams): Trace {
  if (trace.status !== 'running') {
    throw new TraceDomainError(
      `Cannot fail a trace with status "${trace.status}".`,
    );
  }

  const endedAt = new Date();

  return {
    ...trace,
    status: 'failed',
    error: params.error,
    endedAt,
    totalLatencyMs: endedAt.getTime() - trace.startedAt.getTime(),
    metadata: { ...trace.metadata, ...(params.metadata ?? {}) },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function accumulateTokenUsage(
  current: TokenUsage,
  incoming: TokenUsage | null,
): TokenUsage {
  if (!incoming) return current;
  return {
    promptTokens: current.promptTokens + incoming.promptTokens,
    completionTokens: current.completionTokens + incoming.completionTokens,
    totalTokens: current.totalTokens + incoming.totalTokens,
  };
}

// ─── Domain Error ─────────────────────────────────────────────────────────────

export class TraceDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TraceDomainError';
  }
}
