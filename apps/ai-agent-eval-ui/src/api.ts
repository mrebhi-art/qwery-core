import type { TraceDetail, TraceListResponse } from './types';

const API_BASE = import.meta.env.VITE_TRACING_API_BASE ?? '/dashboard/api';
const EVAL_BASE = '/evaluation';

export async function fetchTraces(lookback: string, limit: number) {
  const res = await fetch(`${API_BASE}/traces?lookback=${lookback}&limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Server ${res.status}`);
  }
  return (await res.json()) as TraceListResponse;
}

export async function fetchTrace(traceId: string) {
  const res = await fetch(`${API_BASE}/traces/${traceId}`);
  if (!res.ok) {
    throw new Error(`Server ${res.status}`);
  }
  return (await res.json()) as TraceDetail;
}

// ─── Evaluation API ──────────────────────────────────────────────────────────

export type EvaluationMetricsConfig = {
  sql:     string[];
  chart:   string[];
  tool:    string[];
  overall: string[];
};

export type EvalDataset = { id: string; name: string; description: string; createdAt: string; updatedAt: string };
export type EvalRun = { id: string; datasetId: string; agentVersion: string; agentUrl: string; metrics: EvaluationMetricsConfig; status: string; errorMessage?: string; createdAt: string; startedAt?: string; completedAt?: string };
export type EvalMetricResult = { metric: string; category: string; score: number; passed: boolean; detail?: string };
export type EvalResult = { id: string; runId: string; exampleId: string; agentOutput: string; metrics: EvalMetricResult[]; createdAt: string };

async function evalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${EVAL_BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Server ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const createDataset = (name: string, description: string) =>
  evalFetch<EvalDataset>('/datasets', { method: 'POST', body: JSON.stringify({ name, description }) });

export const uploadExamples = (datasetId: string, examples: Array<{ input: string; goldenOutput: string; context?: string }>) =>
  evalFetch<{ count: number }>(`/datasets/${datasetId}/examples`, { method: 'POST', body: JSON.stringify({ examples }) });

export const startEvalRun = (datasetId: string, agentUrl: string, agentVersion: string, metrics: Partial<EvaluationMetricsConfig>) =>
  evalFetch<EvalRun>('/runs', { method: 'POST', body: JSON.stringify({ datasetId, agentUrl, agentVersion, metrics }) });

export const executeEvalRun = (runId: string) =>
  evalFetch<EvalRun>(`/runs/${runId}/execute`, { method: 'POST' });

export const getEvalRun = (runId: string) =>
  evalFetch<EvalRun>(`/runs/${runId}`);

export const getEvalResults = (runId: string) =>
  evalFetch<{ results: EvalResult[] }>(`/runs/${runId}/results`);

export type TraceDatasetExample = {
  traceId: string;
  goldenOutput: string;
  metadata?: Record<string, string>;
};

export const createDatasetFromTraces = (
  name: string,
  description: string,
  examples: TraceDatasetExample[],
) =>
  evalFetch<{ dataset: EvalDataset; exampleCount: number }>('/datasets/from-traces', {
    method: 'POST',
    body: JSON.stringify({ name, description, examples }),
  });

export type TraceEvalMetricResult = { metric: string; category: string; score: number; passed: boolean; detail?: string };
export type TraceEvalResult = {
  traceId: string;
  inputPreview: string;
  agentOutput: string;
  goldenOutput: string;
  metrics: TraceEvalMetricResult[];
  score: number;
  passed: boolean;
  error?: string;
};
export type EvaluateTracesDirectlyResponse = {
  results: TraceEvalResult[];
  summary: { total: number; passed: number; avgScore: number };
};

export type TraceEvalItem = {
  traceId: string;
  goldenOutput?: string;
  goldenSql?: string;
  goldenChart?: string;
  goldenTool?: string;
};

export const evaluateTracesDirectly = (
  items: TraceEvalItem[],
  metrics: Partial<EvaluationMetricsConfig>,
) =>
  evalFetch<EvaluateTracesDirectlyResponse>('/evaluate-traces', {
    method: 'POST',
    body: JSON.stringify({ items, metrics }),
  });

export const fetchTraceEval = (traceId: string) =>
  evalFetch<{ result: TraceEvalResult | null }>(`/traces/${traceId}/eval`);
