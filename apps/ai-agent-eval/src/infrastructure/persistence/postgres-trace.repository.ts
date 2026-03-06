import postgres from 'postgres';
import type { TraceRepository, ListTracesFilter } from '../../domain/ports/trace-repository.port';
import type { Trace, TraceId, TraceStep, TokenUsage } from '../../domain/trace';

// ─── Row shapes ───────────────────────────────────────────────────────────────

type TraceRow = {
  id: string;
  project_id: string;
  agent_version: string;
  model_name: string;
  input: unknown;
  output: unknown;
  status: string;
  error: string | null;
  total_latency_ms: string;
  total_prompt_tokens: string;
  total_completion_tokens: string;
  total_tokens: string;
  metadata: Record<string, unknown>;
  api_key: string;
  started_at: Date;
  ended_at: Date | null;
};

type StepRow = {
  id: string;
  trace_id: string;
  sequence: string;
  type: string;
  name: string;
  input: unknown;
  output: unknown;
  error: string | null;
  latency_ms: string;
  prompt_tokens: string | null;
  completion_tokens: string | null;
  total_tokens: string | null;
  metadata: Record<string, unknown>;
  artifacts: unknown;
  started_at: Date;
  ended_at: Date;
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToStep(row: StepRow): TraceStep {
  const tokenUsage: TokenUsage | null =
    row.prompt_tokens != null
      ? {
          promptTokens: Number(row.prompt_tokens),
          completionTokens: Number(row.completion_tokens ?? 0),
          totalTokens: Number(row.total_tokens ?? 0),
        }
      : null;

  return {
    id: row.id as TraceStep['id'],
    traceId: row.trace_id as TraceId,
    sequence: Number(row.sequence),
    type: row.type as TraceStep['type'],
    name: row.name,
    input: row.input,
    output: row.output,
    error: row.error,
    latencyMs: Number(row.latency_ms),
    tokenUsage,
    metadata: row.metadata,
    artifacts: Array.isArray(row.artifacts) ? row.artifacts : [],
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function rowToTrace(row: TraceRow, steps: TraceStep[]): Trace {
  return {
    id: row.id as TraceId,
    projectId: row.project_id,
    agentVersion: row.agent_version,
    modelName: row.model_name,
    input: row.input,
    output: row.output,
    steps,
    status: row.status as Trace['status'],
    error: row.error,
    totalLatencyMs: Number(row.total_latency_ms),
    totalTokenUsage: {
      promptTokens: Number(row.total_prompt_tokens),
      completionTokens: Number(row.total_completion_tokens),
      totalTokens: Number(row.total_tokens),
    },
    metadata: row.metadata,
    apiKey: row.api_key,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class PostgresTraceRepository implements TraceRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async save(trace: Trace): Promise<void> {
    // Upsert the trace row
    await this.sql`
      INSERT INTO traces (
        id, project_id, agent_version, model_name,
        input, output, status, error,
        total_latency_ms,
        total_prompt_tokens, total_completion_tokens, total_tokens,
        metadata, api_key, started_at, ended_at
      ) VALUES (
        ${trace.id}, ${trace.projectId}, ${trace.agentVersion}, ${trace.modelName},
        ${JSON.stringify(trace.input)}, ${trace.output !== null ? JSON.stringify(trace.output) : null},
        ${trace.status}, ${trace.error},
        ${trace.totalLatencyMs},
        ${trace.totalTokenUsage.promptTokens},
        ${trace.totalTokenUsage.completionTokens},
        ${trace.totalTokenUsage.totalTokens},
        ${JSON.stringify(trace.metadata)}, ${trace.apiKey},
        ${trace.startedAt}, ${trace.endedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        output                  = EXCLUDED.output,
        status                  = EXCLUDED.status,
        error                   = EXCLUDED.error,
        total_latency_ms        = EXCLUDED.total_latency_ms,
        total_prompt_tokens     = EXCLUDED.total_prompt_tokens,
        total_completion_tokens = EXCLUDED.total_completion_tokens,
        total_tokens            = EXCLUDED.total_tokens,
        metadata                = EXCLUDED.metadata,
        ended_at                = EXCLUDED.ended_at
    `;

    // Upsert all steps
    for (const step of trace.steps) {
      await this.sql`
        INSERT INTO trace_steps (
          id, trace_id, sequence, type, name,
          input, output, error,
          latency_ms,
          prompt_tokens, completion_tokens, total_tokens,
          metadata, artifacts, started_at, ended_at
        ) VALUES (
          ${step.id}, ${step.traceId}, ${step.sequence}, ${step.type}, ${step.name},
          ${JSON.stringify(step.input)},
          ${step.output !== null ? JSON.stringify(step.output) : null},
          ${step.error},
          ${step.latencyMs},
          ${step.tokenUsage?.promptTokens ?? null},
          ${step.tokenUsage?.completionTokens ?? null},
          ${step.tokenUsage?.totalTokens ?? null},
          ${JSON.stringify(step.metadata)},
          ${JSON.stringify(step.artifacts)},
          ${step.startedAt}, ${step.endedAt}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }
  }

  async findById(id: TraceId, apiKey: string): Promise<Trace | null> {
    const rows = await this.sql<TraceRow[]>`
      SELECT * FROM traces WHERE id = ${id} AND api_key = ${apiKey} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;

    const stepRows = await this.sql<StepRow[]>`
      SELECT * FROM trace_steps WHERE trace_id = ${id} ORDER BY sequence ASC
    `;

    return rowToTrace(row, stepRows.map(rowToStep));
  }

  async list(apiKey: string, filter?: ListTracesFilter): Promise<Trace[]> {
    const limit = filter?.limit ?? 50;
    const offset = filter?.offset ?? 0;

    const rows = await this.sql<TraceRow[]>`
      SELECT * FROM traces
      WHERE api_key = ${apiKey}
        ${filter?.projectId ? this.sql`AND project_id = ${filter.projectId}` : this.sql``}
        ${filter?.status ? this.sql`AND status = ${filter.status}` : this.sql``}
      ORDER BY started_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const stepRows = await this.sql<StepRow[]>`
      SELECT * FROM trace_steps WHERE trace_id = ANY(${this.sql.array(ids)}) ORDER BY trace_id, sequence ASC
    `;

    const stepsByTraceId = new Map<string, TraceStep[]>();
    for (const stepRow of stepRows) {
      const list = stepsByTraceId.get(stepRow.trace_id) ?? [];
      list.push(rowToStep(stepRow));
      stepsByTraceId.set(stepRow.trace_id, list);
    }

    return rows.map((row) =>
      rowToTrace(row, stepsByTraceId.get(row.id) ?? []),
    );
  }
}
