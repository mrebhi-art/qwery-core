// Eval-only barrel — imports evalSuite and EvalClient without touching the
// rest of the tracing-sdk (which requires other modules to be built first).
export { EvalClient, EvalClientError } from './eval-client';
export { evalSuite } from './eval-runner';
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
} from './types';
