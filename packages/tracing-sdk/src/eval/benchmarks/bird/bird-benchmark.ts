import { EvalClient } from '../../eval-client';
import { evalSuite } from '../../eval-runner';
import type { EvalCaseResult } from '../../types';
import { BirdTask } from './bird-task';
import { loadBirdExamples } from './bird-loader';
import { evaluateBirdExecutionMetrics } from './bird-execution';
import { extractSqlFromAgentOutput } from './bird-scorer';
import type {
  BirdAgentBehaviorMetrics,
  BirdBenchmarkMeta,
  BirdBenchmarkOptions,
  BirdCaseResult,
  BirdCompositeEvaluation,
  BirdDifficulty,
  BirdEvaluateOptions,
  BirdExample,
} from './types';

const BIRD_PASS_THRESHOLD = 0.8;

function average(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function truncate(value: string, maxChars = 240): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}...`;
}

function previewToString(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '[]';
  try {
    return JSON.stringify(rows);
  } catch {
    return '[unserializable-preview]';
  }
}

function parseCompositePayload(metrics: EvalCaseResult['metrics']): {
  evaluation?: BirdCompositeEvaluation;
  agentBehavior?: BirdAgentBehaviorMetrics;
} {
  const metric = metrics.find((entry) => entry.name === 'bird_final_composite_score');
  const detail = typeof metric?.detail === 'string' ? metric.detail : undefined;
  if (!detail) return {};

  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    const diagnosticsRaw =
      parsed['diagnostics'] && typeof parsed['diagnostics'] === 'object'
        ? (parsed['diagnostics'] as Record<string, unknown>)
        : null;

    const evaluation: BirdCompositeEvaluation | undefined =
      typeof parsed['syntax_valid'] === 'number' &&
      typeof parsed['schema_score'] === 'number' &&
      typeof parsed['structural_f1'] === 'number' &&
      typeof parsed['execution_score'] === 'number' &&
      typeof parsed['top_k_score'] === 'number' &&
      typeof parsed['ves'] === 'number' &&
      typeof parsed['final_score'] === 'number' &&
      typeof parsed['error_type'] === 'string' &&
      diagnosticsRaw
        ? {
            syntax_valid: parsed['syntax_valid'],
            schema_score: parsed['schema_score'],
            structural_f1: parsed['structural_f1'],
            execution_score: parsed['execution_score'],
            top_k_score: parsed['top_k_score'],
            ves: parsed['ves'],
            final_score: parsed['final_score'],
            error_type: parsed['error_type'],
            diagnostics: {
              missing_limit: Boolean(diagnosticsRaw['missing_limit']),
              wrong_join: Boolean(diagnosticsRaw['wrong_join']),
              column_mismatch: Boolean(diagnosticsRaw['column_mismatch']),
              missing_where_filter: Boolean(diagnosticsRaw['missing_where_filter']),
              extra_columns: Boolean(diagnosticsRaw['extra_columns']),
              incorrect_aggregation: Boolean(diagnosticsRaw['incorrect_aggregation']),
              schema_mismatch: Boolean(diagnosticsRaw['schema_mismatch']),
            },
          }
        : undefined;

    const agentBehaviorRaw =
      parsed['agent_behavior'] && typeof parsed['agent_behavior'] === 'object'
        ? (parsed['agent_behavior'] as Record<string, unknown>)
        : null;

    const agentBehavior: BirdAgentBehaviorMetrics | undefined =
      agentBehaviorRaw &&
      typeof agentBehaviorRaw['sqlAttemptsBeforeSuccess'] === 'number' &&
      typeof agentBehaviorRaw['schemaExplorationSteps'] === 'number' &&
      typeof agentBehaviorRaw['toolUsageEfficiency'] === 'number' &&
      typeof agentBehaviorRaw['finalSuccessRate'] === 'number'
        ? {
            sqlAttemptsBeforeSuccess: agentBehaviorRaw['sqlAttemptsBeforeSuccess'],
            schemaExplorationSteps: agentBehaviorRaw['schemaExplorationSteps'],
            toolUsageEfficiency: agentBehaviorRaw['toolUsageEfficiency'],
            finalSuccessRate: agentBehaviorRaw['finalSuccessRate'],
          }
        : undefined;

    return {
      ...(evaluation ? { evaluation } : {}),
      ...(agentBehavior ? { agentBehavior } : {}),
    };
  } catch {
    return {};
  }
}

export class BirdBenchmark {
  private readonly options: BirdBenchmarkOptions;
  private _results: BirdCaseResult[] = [];
  private _runId: string | null = null;
  private _meta: BirdBenchmarkMeta | null = null;

  constructor(options: BirdBenchmarkOptions = {}) {
    this.options = {
      tasks: options.tasks ?? [],
      split: options.split ?? 'mini_dev_sqlite',
      limit: options.limit,
      difficulty: options.difficulty ?? [],
      includeEvidence: options.includeEvidence ?? true,
      execution: options.execution,
    };
  }

  async evaluate(
    agentOrFactory:
      | ((input: string) => Promise<string>)
      | ((dbId: string) => (input: string) => Promise<string>),
    options: BirdEvaluateOptions = {},
  ): Promise<void> {
    const examples = await loadBirdExamples(this.options);
    const examplesById = new Map(examples.map((example) => [example.id, example]));

    // Detect whether the caller passed a factory (arity-1 fn that returns a fn)
    // We do this by calling with a test dbId and checking the return type.
    // Simpler: ask the caller to wrap with BirdBenchmark.agentFactory().
    // We resolve per-case: if agentOrFactory returns a function, it's a factory.
    const resolveAgent = (() => {
      let _isFactory: boolean | null = null;
      return (dbId: string): (input: string) => Promise<string> => {
        if (_isFactory === null) {
          const probe = (agentOrFactory as (x: string) => unknown)(dbId);
          _isFactory = typeof probe === 'function';
        }
        if (_isFactory) {
          return (agentOrFactory as (dbId: string) => (input: string) => Promise<string>)(dbId);
        }
        return agentOrFactory as (input: string) => Promise<string>;
      };
    })();

    const cases = examples.map((example) => {
      let memoKey: string | null = null;
      let memoPromise: ReturnType<typeof evaluateBirdExecutionMetrics> | null = null;

      const evaluateExecution = (generatedOutput: string, groundTruth: string) => {
        const key = `${generatedOutput}\u0000${groundTruth}`;
        if (!memoPromise || memoKey !== key) {
          memoKey = key;
          memoPromise = evaluateBirdExecutionMetrics({
            dbId: example.dbId,
            generatedOutput,
            goldenSql: groundTruth,
            config: this.options.execution,
          });
        }
        return memoPromise;
      };

      return {
        id: example.id,
        input:
          this.options.includeEvidence && example.evidence
            ? `[Evidence: ${example.evidence}]\n\n${example.question}`
            : example.question,
        groundTruth: example.goldenSql,
        metadata: {
          benchmarkId: 'bird',
          birdDbId: example.dbId,
          birdDifficulty: example.difficulty,
          birdQuestion: example.question,
          birdGoldenSql: example.goldenSql,
        },
        agent: resolveAgent(example.dbId),
        customMetrics: [
          {
            name: 'bird_sql_syntax_validity',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.syntaxValidity,
                detail: `error_type=${evalResult.errorType} | sql=${truncate(evalResult.extractedSql)}`,
              };
            },
          },
          {
            name: 'bird_schema_grounding_score',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.schemaGroundingScore,
                detail: `schema_score=${evalResult.schemaGroundingScore.toFixed(3)}`,
              };
            },
          },
          {
            name: 'bird_structural_f1_score',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.structuralF1Score,
                detail: `structural_f1=${evalResult.structuralF1Score.toFixed(3)}`,
              };
            },
          },
          {
            name: 'bird_soft_execution_accuracy',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.softExecutionScore,
                detail: `execution_score=${evalResult.softExecutionScore.toFixed(3)} | error_type=${evalResult.errorType}`,
              };
            },
          },
          {
            name: 'bird_top_k_correctness',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.topKCorrectnessScore,
                detail: `top_k=${evalResult.topKCorrectnessScore.toFixed(2)}`,
              };
            },
          },
          {
            name: 'bird_execution_accuracy_ex',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.executionAccuracyEx,
                detail: `${evalResult.detail} | sql=${truncate(evalResult.extractedSql)}`,
              };
            },
          },
          {
            name: 'bird_valid_efficiency_score_ves',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.validEfficiencyScoreVes,
                detail:
                  `pred_ms=${evalResult.predictedDurationMs ?? 0}, ` +
                  `gold_ms=${evalResult.goldenDurationMs ?? 0}, ` +
                  `pred_rows=${evalResult.predictedRowCount ?? 0}, ` +
                  `gold_rows=${evalResult.goldenRowCount ?? 0}`,
              };
            },
          },
          {
            name: 'bird_soft_f1_score',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.softF1Score,
                detail:
                  `pred_preview=${previewToString(evalResult.predictedTablePreview)} | ` +
                  `gold_preview=${previewToString(evalResult.goldenTablePreview)}`,
              };
            },
          },
          {
            name: 'bird_agent_behavior_score',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              const behavior = evalResult.agentBehavior;
              if (!behavior) {
                return {
                  score: 0,
                  detail: 'agent_behavior=unavailable',
                };
              }

              const behaviorScore =
                0.35 * behavior.finalSuccessRate +
                0.35 * behavior.toolUsageEfficiency +
                0.3 * (1 / Math.max(1, behavior.sqlAttemptsBeforeSuccess));

              return {
                score: behaviorScore,
                detail:
                  `attempts=${behavior.sqlAttemptsBeforeSuccess} | ` +
                  `schema_steps=${behavior.schemaExplorationSteps} | ` +
                  `tool_eff=${behavior.toolUsageEfficiency.toFixed(3)} | ` +
                  `final_success=${behavior.finalSuccessRate.toFixed(2)}`,
              };
            },
          },
          {
            name: 'bird_final_composite_score',
            fn: async (generatedOutput: string, groundTruth: string) => {
              const evalResult = await evaluateExecution(generatedOutput, groundTruth);
              return {
                score: evalResult.finalCompositeScore,
                detail: JSON.stringify({
                  ...evalResult.compositeEvaluation,
                  ...(evalResult.agentBehavior
                    ? { agent_behavior: evalResult.agentBehavior }
                    : {}),
                }),
              };
            },
          },
        ],
      };
    });

    const taskSuffix =
      this.options.tasks && this.options.tasks.length > 0
        ? this.options.tasks.join('-')
        : 'all';
    const difficultySuffix =
      this.options.difficulty && this.options.difficulty.length > 0
        ? this.options.difficulty.join('-')
        : 'all';
    const limitSuffix = this.options.limit ? `limit-${this.options.limit}` : 'all';
    const datasetName =
      options.datasetName ??
      `bird-${this.options.split ?? 'mini_dev_sqlite'}-${taskSuffix}-${difficultySuffix}-${limitSuffix}`;
    const suiteResult = await evalSuite('BIRD Benchmark', {
      datasetName,
      baseUrl: options.baseUrl,
      projectId: options.projectId,
      agentVersion: options.agentVersion ?? '1.0.0',
      caseConcurrency: options.concurrency ?? 1,
      metrics: {
        sql: ['sql_syntax_valid'],
      },
      cases,
    });

    this._runId = suiteResult.runId;
    this._results = suiteResult.results.map((result) =>
      this.mapCaseResult(result, examplesById),
    );
    this._meta = {
      benchmarkId: 'bird',
      split: this.options.split ?? 'mini_dev_sqlite',
      tasks:
        this.options.tasks && this.options.tasks.length > 0
          ? this.options.tasks
          : Object.values(BirdTask),
      difficulty: this.options.difficulty ?? [],
      exampleCount: examples.length,
    };

    if (suiteResult.runId) {
      const client = new EvalClient(options.baseUrl ?? 'http://localhost:4097');
      await client.patchBenchmarkMeta(suiteResult.runId, this._meta);
    }
  }

  get results(): BirdCaseResult[] {
    return this._results;
  }

  get runId(): string | null {
    return this._runId;
  }

  get overallScore(): number {
    const score = average(this._results.map((result) => result.score));
    return score ?? 0;
  }

  get taskScores(): Record<string, number> {
    const grouped = new Map<string, number[]>();
    for (const result of this._results) {
      const scores = grouped.get(result.dbId) ?? [];
      scores.push(result.score);
      grouped.set(result.dbId, scores);
    }
    return Object.fromEntries(
      Array.from(grouped.entries()).map(([dbId, scores]) => [
        dbId,
        average(scores) ?? 0,
      ]),
    );
  }

  get difficultyBreakdown(): Record<BirdDifficulty, number | null> {
    const grouped = new Map<BirdDifficulty, number[]>();
    for (const result of this._results) {
      const scores = grouped.get(result.difficulty) ?? [];
      scores.push(result.score);
      grouped.set(result.difficulty, scores);
    }
    return {
      simple: average(grouped.get('simple') ?? []) ?? null,
      moderate: average(grouped.get('moderate') ?? []) ?? null,
      challenging: average(grouped.get('challenging') ?? []) ?? null,
    };
  }

  get benchmarkMeta(): BirdBenchmarkMeta | null {
    return this._meta;
  }

  private mapCaseResult(
    result: EvalCaseResult,
    examplesById: Map<string, BirdExample>,
  ): BirdCaseResult {
    const example = examplesById.get(result.id);
    if (!example) {
      throw new Error(`[BirdBenchmark] Missing example metadata for result "${result.id}".`);
    }

    const compositeMetric = result.metrics.find(
      (metric) => metric.name === 'bird_final_composite_score',
    );
    const canonicalScore = compositeMetric?.score ?? result.score;
    const parsedPayload = parseCompositePayload(result.metrics);

    return {
      id: result.id,
      dbId: example.dbId,
      difficulty: example.difficulty,
      question: example.question,
      goldenSql: example.goldenSql,
      generatedOutput: result.generatedOutput,
      extractedSql: extractSqlFromAgentOutput(result.generatedOutput),
      ...(parsedPayload.evaluation ? { evaluation: parsedPayload.evaluation } : {}),
      ...(parsedPayload.agentBehavior ? { agentBehavior: parsedPayload.agentBehavior } : {}),
      score: canonicalScore,
      passed: canonicalScore >= BIRD_PASS_THRESHOLD,
      metrics: result.metrics.map((metric) => ({
        name: metric.name,
        score: metric.score,
        passed: metric.passed,
        ...(metric.detail ? { detail: metric.detail } : {}),
      })),
      durationMs: result.durationMs ?? 0,
      ...(result.error ? { error: result.error } : {}),
    };
  }
}
