// ─── Built-in metric name unions ─────────────────────────────────────────────

export type SqlMetricName =
  | 'sql_exact_match'
  | 'sql_normalized_match'
  | 'sql_syntax_valid'
  | 'sql_columns_match';

export type ChartMetricName =
  | 'chart_svg_valid'
  | 'chart_type_match'
  | 'chart_svg_similarity'
  | 'chart_data_present';

export type ToolMetricName =
  | 'tool_called'
  | 'tool_args_exact'
  | 'tool_args_similarity'
  | 'tool_sequence_correct';

export type OverallMetricName =
  | 'exact_match'
  | 'string_similarity'
  | 'pass_fail'
  | 'json_exact_match'
  | 'contains_match';

export type BuiltInMetricsConfig = {
  sql?: SqlMetricName[];
  chart?: ChartMetricName[];
  tool?: ToolMetricName[];
  overall?: OverallMetricName[];
};

// ─── Custom metric ────────────────────────────────────────────────────────────

export type CustomMetric = {
  /** Unique name stored alongside built-in metrics. */
  name: string;
  /**
   * Pure scoring function evaluated client-side.
   * Return a value in [0, 1].  Score >= 0.8 counts as passed.
   */
  fn: (agentOutput: string, goldenOutput: string) => number | Promise<number>;
};

// ─── Eval case ────────────────────────────────────────────────────────────────

export type EvalCase = {
  /**
   * Stable identifier for this case.
   * Used to deduplicate examples across runs — the same dataset example is
   * reused if the id already exists.
   */
  id: string;

  /** The input fed to the agent (prompt, query, message, …). */
  input: string;

  /** The expected / reference output scored against agent output. */
  goldenOutput: string;

  /**
   * Your agent function.  Receives the input and must return the agent output
   * as a string.  Called directly — no HTTP needed.
   */
  agent: (input: string) => Promise<string>;

  /** Optional custom metrics evaluated client-side before posting to the backend. */
  customMetrics?: CustomMetric[];
};

// ─── evalSuite options ────────────────────────────────────────────────────────

export type EvalSuiteOptions = {
  /**
   * Base URL of the qwery-eval backend.
   * Defaults to 'http://localhost:4097'.
   */
  baseUrl?: string;

  /**
   * Human-readable dataset name.
   * If a dataset with this name already exists it is reused;
   * new examples are appended for case ids not yet present.
   */
  datasetName: string;

  /** Free-form version tag for the agent under evaluation. */
  agentVersion?: string;

  /** Built-in metric categories to score on the backend. */
  metrics?: BuiltInMetricsConfig;

  /** The evaluation cases. */
  cases: EvalCase[];
};

// ─── Results ─────────────────────────────────────────────────────────────────

export type MetricScore = {
  name: string;
  category: string;
  score: number;
  passed: boolean;
  detail?: string;
};

export type EvalCaseResult = {
  id: string;
  input: string;
  agentOutput: string;
  goldenOutput: string;
  metrics: MetricScore[];
  score: number;
  passed: boolean;
  durationMs?: number;
  error?: string;
};

export type EvalSuiteResult = {
  datasetId: string;
  runId: string;
  results: EvalCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
  };
};

// ─── Wire types (EvalClient internals) ───────────────────────────────────────

export type EvalDatasetRow = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type EvalExampleRow = {
  id: string;
  datasetId: string;
  input: string;
  goldenOutput: string;
  context: string | null;
  metadata: Record<string, string>;
  createdAt: string;
};

export type EvalRunRow = {
  id: string;
  datasetId: string;
  agentVersion: string;
  status: string;
  createdAt: string;
};

export type InlineOutput = {
  exampleId: string;
  agentOutput: string;
  customMetrics?: { name: string; score: number; passed: boolean; detail?: string }[];
};

export type InlineExecuteResponse = {
  runId: string;
  total: number;
  passed: number;
  failed: number;
  avgScore: number;
  results: Array<{
    exampleId: string;
    agentOutput: string;
    goldenOutput: string;
    metrics: MetricScore[];
    score: number;
    passed: boolean;
    error?: string;
  }>;
};
