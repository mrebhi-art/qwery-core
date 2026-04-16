// ─── Mirrored from the microservice domain ────────────────────────────────────
// The SDK is a pure client — it never imports from apps/tracing directly.

export type TraceStatus = 'running' | 'completed' | 'failed';

export type StepType =
  | 'llm_call'
  | 'tool_call'
  | 'retrieval'
  | 'reasoning'
  | 'custom';

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type TraceStep = {
  id: string;
  traceId: string;
  sequence: number;
  type: StepType;
  name: string;
  input: unknown;
  output: unknown;
  error: string | null;
  latencyMs: number;
  tokenUsage: TokenUsage | null;
  metadata: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
};

export type Trace = {
  id: string;
  projectId: string;
  conversationId: string;
  agentVersion: string;
  modelName: string;
  input: unknown;
  output: unknown;
  steps: TraceStep[];
  status: TraceStatus;
  error: string | null;
  totalLatencyMs: number;
  totalTokenUsage: TokenUsage;
  metadata: Record<string, unknown>;
  startedAt: string;
  endedAt: string | null;
};

// ─── SDK configuration ────────────────────────────────────────────────────────

export type TracingSdkConfig = {
  /** Base URL of the tracing microservice. e.g. http://localhost:4097 */
  baseUrl: string;
  /** API key for authentication (Bearer token) */
  apiKey: string;
  /** Flush queue size before forced flush. Default: 50 */
  maxQueueSize?: number;
  /** Flush interval in ms. Default: 2000 */
  flushIntervalMs?: number;
  /** Max retry attempts on network error. Default: 3 */
  maxRetries?: number;
  /** Retry base delay in ms (exponential). Default: 200 */
  retryBaseDelayMs?: number;
  /** If true, SDK will not throw on tracing errors. Default: true */
  failSilently?: boolean;
};

// ─── Queued operations ────────────────────────────────────────────────────────

export type CreateTracePayload = {
  projectId: string;
  conversationId?: string;
  agentVersion: string;
  modelName: string;
  input: unknown;
  metadata?: Record<string, unknown>;
};

export type AddStepPayload = {
  type: StepType;
  name: string;
  input: unknown;
  output: unknown;
  error?: string | null;
  latencyMs: number;
  tokenUsage?: TokenUsage | null;
  metadata?: Record<string, unknown>;
  artifacts?: Array<{
    name: string;
    type: 'table' | 'chart' | 'image' | 'sql' | 'text';
    mimeType: string;
    data: string;
    encoding: 'utf8' | 'base64';
  }>;
  startedAt: Date;
  endedAt: Date;
};

export type CompleteTracePayload = {
  output: unknown;
  metadata?: Record<string, unknown>;
};

export type FailTracePayload = {
  error: string;
  metadata?: Record<string, unknown>;
};
