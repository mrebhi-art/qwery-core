// Eval-only barrel — imports evalSuite and EvalClient without touching the
// rest of the tracing-sdk (which requires other modules to be built first).
export { EvalClient, EvalClientError } from './eval-client';
export { evalSuite } from './eval-runner';
export { evalConversation } from './conversation-runner';
export { BirdBenchmark, BirdTask } from './benchmarks';
export {
  EvalDataset,
  ConversationEvalDataset,
} from './eval-dataset';
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
} from './types';
export type {
  Golden,
  ConversationGolden,
  EvalDatasetOptions,
  ConversationEvalDatasetOptions,
  PushOptions,
  PullOptions,
} from './eval-dataset';
export type {
  BirdAgentBehaviorMetrics,
  BirdBenchmarkMeta,
  BirdBenchmarkOptions,
  BirdCaseResult,
  BirdCompositeEvaluation,
  BirdDifficulty,
  BirdExecutionConfig,
  BirdExecutionEvaluation,
  BirdEvaluateOptions,
  BirdExample,
  BirdMetricResult,
  BirdSplit,
} from './benchmarks';
