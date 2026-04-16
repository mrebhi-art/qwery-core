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
  | 'contains_match'
  | 'task_completion'
  | 'argument_correctness'
  | 'tool_correctness'
  | 'step_efficiency'
  | 'plan_adherence'
  | 'plan_quality';

export type BuiltInMetricsConfig = {
  sql?: SqlMetricName[];
  chart?: ChartMetricName[];
  tool?: ToolMetricName[];
  overall?: OverallMetricName[];
};

// ─── Shared eval data primitives ─────────────────────────────────────────────

export type FreeformMetadata = Record<string, unknown>;

export type EvalContext = string | FreeformMetadata;

export type EvalHelpers = FreeformMetadata;

export type ExpectedToolCall =
  | string
  | {
      name: string;
      arguments?: unknown;
      required?: boolean;
    };

// ─── Custom metric ────────────────────────────────────────────────────────────

export type CustomMetric = {
  /** Unique name stored alongside built-in metrics. */
  name: string;
  /**
   * Pure scoring function evaluated client-side.
   * Return a value in [0, 1].  Score >= 0.8 counts as passed.
   */
  fn: (
    generatedOutput: string,
    groundTruth: string,
  ) =>
    | number
    | { score: number; detail?: string }
    | Promise<number | { score: number; detail?: string }>;
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

  /** The expected / reference output scored against generated output. */
  groundTruth: string;

  /** Optional case-level context used by the evaluator/runner. */
  context?: EvalContext;

  /** Optional helper payload used by runner integration (datasource, fixtures, etc.). */
  helpers?: EvalHelpers;

  /** Optional expected tool calls used by tool metrics. */
  expectedTools?: ExpectedToolCall[];

  /** Optional metadata persisted with the dataset example. */
  metadata?: FreeformMetadata;

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
  /** Optional project id to scope datasets and run summaries. */
  projectId?: string;
  /** Optional datasource id stored in example metadata for quality diagnostics. */
  datasourceId?: string;
  /** Max number of cases to execute concurrently (defaults to env or 2). */
  caseConcurrency?: number;

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

export type EvalTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costInCredits?: number;
};

export type EvalSqlExecutionSummary = {
  totalMs: number;
  averageMs: number;
  casesWithSqlTiming: number;
};

export type EvalCaseResult = {
  id: string;
  input: string;

  /** The model/agent output generated for this case. */
  generatedOutput: string;
  rawOutput?: string;

  extractedOutput?: string;

  /** Ground truth used for scoring. */
  groundTruth: string;

  /** Optional tool calls captured during run execution. */
  actualTools?: ExpectedToolCall[];

  metrics: MetricScore[];
  score: number;
  passed: boolean;
  durationMs?: number;
  tokenUsage?: EvalTokenUsage;
  sqlExecutionTimeMs?: number;
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
    tokenUsage?: EvalTokenUsage;
    sqlExecution?: EvalSqlExecutionSummary;
  };
};

// ─── Wire types (EvalClient internals) ───────────────────────────────────────

export type EvalDatasetRow = {
  id: string;
  projectId?: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type EvalExampleRow = {
  id: string;
  datasetId: string;
  input: string;
  groundTruth: string;

  context: EvalContext | null;
  helpers?: EvalHelpers | null;
  expectedTools?: ExpectedToolCall[] | null;
  metadata: FreeformMetadata;
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
  generatedOutput: string;

  actualTools?: ExpectedToolCall[];
  metadata?: FreeformMetadata;

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
    generatedOutput: string;
    groundTruth: string;

    actualTools?: ExpectedToolCall[];
    metrics: MetricScore[];
    score: number;
    passed: boolean;
    error?: string;
  }>;
};

// ─── Conversation eval types ─────────────────────────────────────────────────

export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ConversationTurnSpec = {
  input: string;
  groundTruth?: string | null;

  context?: EvalContext;
  helpers?: EvalHelpers;
  expectedTools?: ExpectedToolCall[];
  metadata?: FreeformMetadata;
};

export type ConversationMetricName =
  | 'context_retention'
  | 'conversation_coherence'
  | 'task_completion'
  | 'turn_consistency'
  | 'no_contradictions'
  | 'length_efficiency';

export type ConversationMetricsConfig = {
  perTurn?: BuiltInMetricsConfig;
  conversation?: ConversationMetricName[];
};

export type ConversationCustomTurnMetric = {
  name: string;
  fn: (
    generatedOutput: string,
    groundTruth: string | undefined,
    history: ConversationMessage[],
  ) => number | Promise<number>;
};

export type ConversationCustomMetric = {
  name: string;
  fn: (transcript: ConversationMessage[]) => number | Promise<number>;
};

export type ConversationEvalCase = {
  id: string;

  context?: EvalContext;
  helpers?: EvalHelpers;
  expectedTools?: ExpectedToolCall[];
  metadata?: FreeformMetadata;

  turns: ConversationTurnSpec[];
  agent: (history: ConversationMessage[], input: string) => Promise<string>;
  customTurnMetrics?: ConversationCustomTurnMetric[];
  customConversationMetrics?: ConversationCustomMetric[];
};

export type ConversationEvalSuiteOptions = {
  baseUrl?: string;
  datasetName: string;
  /** Optional project id to scope datasets and run summaries. */
  projectId?: string;
  /** Optional datasource id stored in example metadata for quality diagnostics. */
  datasourceId?: string;
  /** Max number of cases to execute concurrently (defaults to env or 2). */
  caseConcurrency?: number;
  agentVersion?: string;
  metrics?: ConversationMetricsConfig;
  cases: ConversationEvalCase[];
};

export type ConversationTurnResult = {
  turnIndex: number;

  input: string;

  generatedOutput: string;

  groundTruth?: string | null;

  actualTools?: ExpectedToolCall[];

  turnMetrics: MetricScore[];
  turnScore: number;
  durationMs: number;
  error?: string;
};

export type ConversationCaseResult = {
  id: string;
  turns: ConversationTurnResult[];
  conversationMetrics: MetricScore[];
  overallScore: number;
  passed: boolean;
  error?: string;
};

export type ConversationEvalSuiteResult = {
  datasetId: string;
  runId: string;
  results: ConversationCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
    avgTurns: number;
  };
};

// ─── Conversation wire types (EvalClient internals) ─────────────────────────

export type ConversationEvalDatasetRow = {
  id: string;
  projectId?: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationEvalExampleRow = {
  id: string;
  datasetId: string;
  turns: Array<{
    input: string;
    groundTruth?: string | null;
    context?: EvalContext;
    helpers?: EvalHelpers;
    expectedTools?: ExpectedToolCall[];
    metadata?: FreeformMetadata;
  }>;
  context?: EvalContext | null;
  helpers?: EvalHelpers | null;
  expectedTools?: ExpectedToolCall[] | null;
  metadata: FreeformMetadata;
  createdAt: string;
};

export type ConversationEvalRunRow = {
  id: string;
  datasetId: string;
  agentVersion: string;
  status: string;
  createdAt: string;
};

export type ConversationInlineOutput = {
  exampleId: string;
  turns: Array<{
    generatedOutput: string;

    actualTools?: ExpectedToolCall[];
    metadata?: FreeformMetadata;
    durationMs?: number;
    customMetrics?: { name: string; score: number; passed: boolean; detail?: string }[];
  }>;
};

export type ConversationInlineExecuteResponse = {
  runId: string;
  total: number;
  passed: number;
  failed: number;
  avgScore: number;
  results: Array<{
    exampleId: string;
    turns: Array<{
      turnIndex: number;
      input: string;
      generatedOutput: string;
      groundTruth?: string | null;
      actualTools?: ExpectedToolCall[];
      turnMetrics: Array<{
        metric?: string;
        name?: string;
        category: string;
        score: number;
        passed: boolean;
        detail?: string;
      }>;
      turnScore: number;
      durationMs: number;
      error?: string;
    }>;
    conversationMetrics: Array<{
      metric?: string;
      name?: string;
      category?: string;
      score: number;
      passed: boolean;
      detail?: string;
    }>;
    overallScore: number;
    passed: boolean;
    error?: string;
  }>;
};

export type ConversationVersionComparisonResult = {
  dataset: { id: string; name: string };
  versionA: { runId: string; agentVersion: string; completedAt: string | null };
  versionB: { runId: string; agentVersion: string; completedAt: string | null };
  summary: {
    improved: number;
    regressed: number;
    unchanged: number;
    avgScoreA: number;
    avgScoreB: number;
    avgDelta: number;
  };
  cases: Array<{
    exampleId: string;
    caseId: string | null;
    scoreA: number;
    scoreB: number;
    delta: number;
    status: 'improved' | 'regressed' | 'unchanged';
    turnsA: unknown[];
    turnsB: unknown[];
    conversationMetricsA: unknown[];
    conversationMetricsB: unknown[];
  }>;
};
