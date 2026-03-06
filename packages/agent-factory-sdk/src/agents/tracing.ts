export type TraceArtifact = {
  name: string;
  type: 'table' | 'chart' | 'image' | 'sql' | 'text';
  mimeType: string;
  data: string;
  encoding: 'utf8' | 'base64';
};

export type TraceSessionLike = {
  addStep: (params: {
    type: 'llm_call' | 'tool_call' | 'retrieval' | 'reasoning' | 'custom';
    name: string;
    input: unknown;
    output: unknown;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | null;
    error?: string | null;
    latencyMs: number;
    startedAt: Date;
    endedAt: Date;
    metadata?: Record<string, unknown>;
    artifacts?: TraceArtifact[];
  }) => void;
  addLlmStep: (params: {
    name: string;
    input: unknown;
    output: unknown;
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | null;
    error?: string | null;
    latencyMs: number;
    startedAt: Date;
    endedAt: Date;
    metadata?: Record<string, unknown>;
  }) => void;
  addToolStep: (params: {
    name: string;
    input: unknown;
    output: unknown;
    error?: string | null;
    latencyMs: number;
    startedAt: Date;
    endedAt: Date;
    metadata?: Record<string, unknown>;
    artifacts?: TraceArtifact[];
  }) => void;
  addRetrievalStep: (params: {
    name: string;
    input: unknown;
    output: unknown;
    error?: string | null;
    latencyMs: number;
    startedAt: Date;
    endedAt: Date;
    metadata?: Record<string, unknown>;
  }) => void;
};
