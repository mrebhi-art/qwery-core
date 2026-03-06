export type TraceListItem = {
  traceId: string;
  conversationId: string;
  conversationSlug: string;
  startTime: string;
  inputValue: string;
  model: string;
  spanCount: number;
  durationMs: number;
  status: 'ok' | 'error';
  tokens: { total: number };
  toolCalls: string[];
};

export type Span = {
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  startTimeUs: number;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, string>;
  events?: Array<{ name: string; timestamp: string }>;
  artifacts?: Artifact[];
};

export type TraceDetail = {
  traceId: string;
  spanCount: number;
  rootOperation: string;
  spans: Span[];
};

export type TraceListResponse = {
  traces: TraceListItem[];
};

export type ArtifactType = 'table' | 'chart' | 'image' | 'sql' | 'text';

export type Artifact = {
  name: string;
  type: ArtifactType;
  mimeType: string;
  data: string;
  encoding: 'utf8' | 'base64';
};
