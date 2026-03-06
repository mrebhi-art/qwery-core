import postgres from 'postgres';
import type { EvaluationRepository } from '../../domain/ports/evaluation-repository.port';
import type {
  EvaluationRun,
  EvaluationRunId,
  EvaluationResult,
  EvaluationResultId,
  EvaluationRunStatus,
  EvaluationMetricsConfig,
  DatasetId,
  MetricResult,
  MetricCategory,
} from '../../domain/evaluation';
import { EMPTY_METRICS_CONFIG } from '../../domain/evaluation';

type RunRow = {
  id: string;
  dataset_id: string;
  agent_version: string;
  agent_url: string;
  metrics: unknown; // JSONB — parsed into EvaluationMetricsConfig
  status: string;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

type ResultRow = {
  id: string;
  run_id: string;
  example_id: string;
  agent_output: string;
  metrics: Array<{ metric: string; category: string; score: number; passed: boolean; detail?: string }>;
  created_at: Date;
};

function parseMetricsConfig(raw: unknown): EvaluationMetricsConfig {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return EMPTY_METRICS_CONFIG;
  }
  const r = raw as Record<string, unknown>;
  return {
    sql:     Array.isArray(r['sql'])     ? (r['sql'] as EvaluationMetricsConfig['sql'])     : [],
    chart:   Array.isArray(r['chart'])   ? (r['chart'] as EvaluationMetricsConfig['chart'])   : [],
    tool:    Array.isArray(r['tool'])    ? (r['tool'] as EvaluationMetricsConfig['tool'])    : [],
    overall: Array.isArray(r['overall']) ? (r['overall'] as EvaluationMetricsConfig['overall']) : [],
  };
}

function rowToRun(row: RunRow): EvaluationRun {
  return {
    id: row.id as EvaluationRunId,
    datasetId: row.dataset_id as DatasetId,
    agentVersion: row.agent_version,
    agentUrl: row.agent_url,
    metrics: parseMetricsConfig(row.metrics),
    status: row.status as EvaluationRunStatus,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function rowToResult(row: ResultRow): EvaluationResult {
  return {
    id: row.id as EvaluationResultId,
    runId: row.run_id as EvaluationRunId,
    exampleId: row.example_id as import('../../domain/evaluation').DatasetExampleId,
    agentOutput: row.agent_output,
    metrics: row.metrics.map((m): MetricResult => ({
      metric: m.metric as MetricResult['metric'],
      category: m.category as MetricCategory,
      score: m.score,
      passed: m.passed,
      ...(m.detail != null ? { detail: m.detail } : {}),
    })),
    createdAt: row.created_at,
  };
}

export class PostgresEvaluationRepository implements EvaluationRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async saveRun(run: EvaluationRun): Promise<void> {
    await this.sql`
      INSERT INTO eval_runs (id, dataset_id, agent_version, agent_url, metrics, status,
        error_message, created_at, started_at, completed_at)
      VALUES (${run.id}, ${run.datasetId}, ${run.agentVersion}, ${run.agentUrl},
        ${JSON.stringify(run.metrics)}, ${run.status}, ${run.errorMessage ?? null},
        ${run.createdAt}, ${run.startedAt ?? null}, ${run.completedAt ?? null})
    `;
  }

  async updateRun(run: EvaluationRun): Promise<void> {
    await this.sql`
      UPDATE eval_runs SET
        status = ${run.status},
        error_message = ${run.errorMessage ?? null},
        started_at = ${run.startedAt ?? null},
        completed_at = ${run.completedAt ?? null}
      WHERE id = ${run.id}
    `;
  }

  async findRunById(id: EvaluationRunId): Promise<EvaluationRun | null> {
    const rows = await this.sql<RunRow[]>`SELECT * FROM eval_runs WHERE id = ${id}`;
    return rows[0] ? rowToRun(rows[0]) : null;
  }

  async listRuns(datasetId?: string): Promise<EvaluationRun[]> {
    const rows = datasetId
      ? await this.sql<RunRow[]>`SELECT * FROM eval_runs WHERE dataset_id = ${datasetId} ORDER BY created_at DESC`
      : await this.sql<RunRow[]>`SELECT * FROM eval_runs ORDER BY created_at DESC`;
    return rows.map(rowToRun);
  }

  async saveResult(result: EvaluationResult): Promise<void> {
    await this.sql`
      INSERT INTO eval_results (id, run_id, example_id, agent_output, metrics, created_at)
      VALUES (${result.id}, ${result.runId}, ${result.exampleId}, ${result.agentOutput},
        ${JSON.stringify(result.metrics)}, ${result.createdAt})
    `;
  }

  async listResults(runId: EvaluationRunId): Promise<EvaluationResult[]> {
    const rows = await this.sql<ResultRow[]>`
      SELECT * FROM eval_results WHERE run_id = ${runId} ORDER BY created_at ASC
    `;
    return rows.map(rowToResult);
  }

  async updateRunStatus(
    id: EvaluationRunId,
    status: EvaluationRunStatus,
    patch?: Partial<Pick<EvaluationRun, 'errorMessage' | 'startedAt' | 'completedAt'>>,
  ): Promise<void> {
    await this.sql`
      UPDATE eval_runs SET
        status = ${status},
        error_message = ${patch?.errorMessage ?? null},
        started_at = ${patch?.startedAt ?? null},
        completed_at = ${patch?.completedAt ?? null}
      WHERE id = ${id}
    `;
  }
}
