// ─── Eval ─────────────────────────────────────────────────────────────────────
export { EvalClient, EvalClientError } from './eval/eval-client';
export { evalSuite } from './eval/eval-runner';
export { evalConversation } from './eval/conversation-runner';
export type {
  EvalCase,
  EvalSuiteOptions,
  EvalSuiteResult,
  EvalCaseResult,
  MetricScore,
  CustomMetric,
  BuiltInMetricsConfig,
  SqlMetricName,
  ChartMetricName,
  ToolMetricName,
  OverallMetricName,
  InlineOutput,
  InlineExecuteResponse,
  ConversationMessage,
  ConversationTurnSpec,
  ConversationMetricName,
  ConversationMetricsConfig,
  ConversationCustomTurnMetric,
  ConversationCustomMetric,
  ConversationEvalCase,
  ConversationEvalSuiteOptions,
  ConversationTurnResult,
  ConversationCaseResult,
  ConversationEvalSuiteResult,
  ConversationInlineOutput,
  ConversationInlineExecuteResponse,
  ConversationVersionComparisonResult,
} from './eval/types';

// ─── Core ─────────────────────────────────────────────────────────────────────
export { TracingSdk } from './core/tracing-sdk';
export { TraceSession } from './core/trace-session';
export { FlushWorker } from './core/flush-worker';

// ─── Client ───────────────────────────────────────────────────────────────────
export { TracingHttpClient, TracingClientError } from './client/tracing-http-client';

// ─── Wrappers ─────────────────────────────────────────────────────────────────
export { tracedLLM } from './wrappers/traced-llm';
export { tracedTool } from './wrappers/traced-tool';
export { tracedRetriever } from './wrappers/traced-retriever';

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  TracingSdkConfig,
  Trace,
  TraceStep,
  TraceStatus,
  StepType,
  TokenUsage,
  CreateTracePayload,
  AddStepPayload,
  CompleteTracePayload,
  FailTracePayload,
} from './types';
