import type {
  BuiltInMetricsConfig,
  EvalContext,
  EvalHelpers,
  ExpectedToolCall,
  FreeformMetadata,
  ConversationEvalDatasetRow,
  ConversationEvalExampleRow,
  ConversationEvalRunRow,
  ConversationInlineExecuteResponse,
  ConversationInlineOutput,
  ConversationMetricName,
  ConversationVersionComparisonResult,
  EvalDatasetRow,
  EvalExampleRow,
  EvalRunRow,
  InlineExecuteResponse,
  InlineOutput,
} from './types';

function resolveGroundTruth(input: { groundTruth: string }): string {
  const value = input.groundTruth.trim();
  if (!value) {
    throw new Error('[EvalClient] Missing groundTruth for dataset example');
  }
  return value;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class EvalClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly url: string,
    public readonly details?: unknown,
  ) {
    super(`[EvalClient] ${statusCode} ${url}: ${message}`);
    this.name = 'EvalClientError';
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Thin HTTP wrapper over the qwery-eval REST API.
 * Used internally by `evalSuite` — you can also use it directly if you need
 * lower-level access to datasets, runs, or results.
 */
export class EvalClient {
  private readonly base: string;

  constructor(baseUrl = 'http://localhost:4097') {
    this.base = baseUrl.replace(/\/$/, '');
  }

  // ── Datasets ──────────────────────────────────────────────────────────────

  /**
   * Returns the id of a dataset matching `name`.
   * Creates it if it doesn't exist yet.
   */
  async findOrCreateDataset(
    name: string,
    description = '',
    projectId?: string,
  ): Promise<string> {
    const qp = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const { datasets } = await this.get<{ datasets: EvalDatasetRow[] }>(
      `/evaluation/datasets${qp}`,
    );
    const existing = datasets.find((d) => d.name === name);
    if (existing) return existing.id;

    const created = await this.post<EvalDatasetRow>('/evaluation/datasets', {
      name,
      description,
      ...(projectId ? { projectId } : {}),
    });
    return created.id;
  }

  async listDatasets(projectId?: string): Promise<EvalDatasetRow[]> {
    const qp = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const { datasets } = await this.get<{ datasets: EvalDatasetRow[] }>(
      `/evaluation/datasets${qp}`,
    );
    return datasets;
  }

  async getDataset(datasetId: string): Promise<{ dataset: EvalDatasetRow; examples: EvalExampleRow[] }> {
    return this.get(`/evaluation/datasets/${datasetId}`);
  }

  // ── Examples ──────────────────────────────────────────────────────────────

  /**
   * Upload examples to a dataset.
   * Returns the list of persisted example ids (in the same order as input).
   */
  async uploadExamples(
    datasetId: string,
    examples: Array<{
      input: string;
      groundTruth: string;
      context?: EvalContext;
      helpers?: EvalHelpers;
      expectedTools?: ExpectedToolCall[];
      metadata?: FreeformMetadata;
    }>,
  ): Promise<string[]> {
    const normalized = examples.map((example) => {
      const groundTruth = resolveGroundTruth(example);
      return {
        input: example.input,
        groundTruth,
        goldenOutput: groundTruth,
        context: example.context,
        helpers: example.helpers,
        expectedTools: example.expectedTools,
        metadata: example.metadata,
      };
    });

    const { examples: rows } = await this.post<{ count: number; examples: EvalExampleRow[] }>(
      `/evaluation/datasets/${datasetId}/examples`,
      { examples: normalized },
    );
    return rows.map((e) => e.id);
  }

  // ── Runs ──────────────────────────────────────────────────────────────────

  async startRun(params: {
    datasetId: string;
    agentVersion: string;
    /** agentUrl is required by the schema but unused for inline runs — use a placeholder. */
    agentUrl?: string;
    metrics: BuiltInMetricsConfig;
  }): Promise<string> {
    const run = await this.post<EvalRunRow>('/evaluation/runs', {
      datasetId: params.datasetId,
      agentVersion: params.agentVersion,
      agentUrl: params.agentUrl ?? 'inline://',
      metrics: {
        sql: params.metrics.sql ?? [],
        chart: params.metrics.chart ?? [],
        tool: params.metrics.tool ?? [],
        overall: params.metrics.overall ?? [],
      },
    });
    return run.id;
  }

  async listRunsForDataset(datasetId: string): Promise<EvalRunRow[]> {
    const { runs } = await this.get<{ runs: EvalRunRow[] }>(`/evaluation/runs?datasetId=${datasetId}`);
    return runs;
  }

  /**
   * Tag an evaluation run with benchmark metadata (e.g. BIRD split, tasks, difficulty).
   * Returns `true` on success, `false` if the backend doesn't support benchmark metadata
   * (e.g. no DATABASE_URL) — the benchmark run itself is unaffected.
   */
  async patchBenchmarkMeta(
    runId: string,
    benchmarkMeta: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.patch(`/evaluation/runs/${runId}/benchmark-meta`, {
        benchmark_meta: benchmarkMeta,
      });
      return true;
    } catch {
      // Non-fatal: backend may not have DATABASE_URL or the route may not exist yet.
      return false;
    }
  }

  async getBenchmarkMeta(runId: string): Promise<Record<string, unknown> | null> {
    const { benchmarkMeta } = await this.get<{
      benchmarkMeta: Record<string, unknown> | null;
    }>(`/evaluation/runs/${runId}/benchmark-meta`);
    return benchmarkMeta;
  }

  async listBenchmarkRuns(params?: {
    projectId?: string;
    benchmarkId?: string;
    datasetName?: string;
  }): Promise<EvalRunRow[]> {
    const query = new URLSearchParams();
    if (params?.projectId) query.set('projectId', params.projectId);
    if (params?.benchmarkId) query.set('benchmarkId', params.benchmarkId);
    if (params?.datasetName) query.set('datasetName', params.datasetName);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    const { runs } = await this.get<{ runs: EvalRunRow[] }>(
      `/evaluation/benchmarks/runs${suffix}`,
    );
    return runs;
  }

  // ── Conversation datasets/runs ───────────────────────────────────────────

  async findOrCreateConversationDataset(
    name: string,
    description = '',
    projectId?: string,
  ): Promise<string> {
    const qp = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const { datasets } = await this.get<{ datasets: ConversationEvalDatasetRow[] }>(
      `/evaluation/conversations/datasets${qp}`,
    );
    const existing = datasets.find((d) => d.name === name);
    if (existing) return existing.id;

    const created = await this.post<ConversationEvalDatasetRow>(
      '/evaluation/conversations/datasets',
      { name, description, ...(projectId ? { projectId } : {}) },
    );
    return created.id;
  }

  async listConversationDatasets(projectId?: string): Promise<ConversationEvalDatasetRow[]> {
    const qp = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const { datasets } = await this.get<{ datasets: ConversationEvalDatasetRow[] }>(
      `/evaluation/conversations/datasets${qp}`,
    );
    return datasets;
  }

  async getConversationDataset(
    datasetId: string,
  ): Promise<{
    dataset: ConversationEvalDatasetRow;
    examples: ConversationEvalExampleRow[];
  }> {
    return this.get(`/evaluation/conversations/datasets/${datasetId}`);
  }

  async uploadConversationExamples(
    datasetId: string,
    examples: Array<{
      turns: Array<{
        input: string;
        groundTruth?: string | null;
        context?: EvalContext;
        helpers?: EvalHelpers;
        expectedTools?: ExpectedToolCall[];
        metadata?: FreeformMetadata;
      }>;
      context?: EvalContext;
      helpers?: EvalHelpers;
      expectedTools?: ExpectedToolCall[];
      metadata?: FreeformMetadata;
    }>,
  ): Promise<string[]> {
    const normalized = examples.map((example) => {
      const turns = example.turns.map((turn) => ({
        userMessage: turn.input.trim(),
        goldenResponse: turn.groundTruth ?? null,
      }));

      for (const turn of turns) {
        if (!turn.userMessage) {
          throw new Error('[EvalClient] Conversation turn is missing input');
        }
      }

      return {
        turns,
        metadata: example.metadata,
      };
    });

    const { examples: rows } = await this.post<{
      count: number;
      examples: ConversationEvalExampleRow[];
    }>(
      `/evaluation/conversations/datasets/${datasetId}/examples`,
      { examples: normalized },
    );
    return rows.map((e) => e.id);
  }

  async startConversationRun(params: {
    datasetId: string;
    agentVersion: string;
    perTurnMetrics: BuiltInMetricsConfig;
    conversationMetrics?: ConversationMetricName[];
  }): Promise<string> {
    const run = await this.post<ConversationEvalRunRow>('/evaluation/conversations/runs', {
      datasetId: params.datasetId,
      agentVersion: params.agentVersion,
      perTurnMetrics: {
        sql: params.perTurnMetrics.sql ?? [],
        chart: params.perTurnMetrics.chart ?? [],
        tool: params.perTurnMetrics.tool ?? [],
        overall: params.perTurnMetrics.overall ?? [],
      },
      conversationMetrics: params.conversationMetrics ?? [],
    });
    return run.id;
  }

  async listConversationRunsForDataset(datasetId: string): Promise<ConversationEvalRunRow[]> {
    const { runs } = await this.get<{ runs: ConversationEvalRunRow[] }>(
      `/evaluation/conversations/runs?datasetId=${datasetId}`,
    );
    return runs;
  }

  async executeConversationInline(
    runId: string,
    outputs: ConversationInlineOutput[],
  ): Promise<ConversationInlineExecuteResponse> {
    const normalized = outputs.map((output) => ({
      exampleId: output.exampleId,
      turns: output.turns.map((turn) => ({
        agentResponse: turn.generatedOutput,
        durationMs: turn.durationMs,
        customMetrics: turn.customMetrics ?? [],
      })),
    }));

    return this.post<ConversationInlineExecuteResponse>(
      `/evaluation/conversations/runs/${runId}/execute-inline`,
      { outputs: normalized },
    );
  }

  async compareConversationVersions(
    datasetName: string,
    versionA: string,
    versionB: string,
  ): Promise<ConversationVersionComparisonResult> {
    return this.get<ConversationVersionComparisonResult>(
      `/evaluation/conversations/runs/compare?datasetName=${encodeURIComponent(datasetName)}&versionA=${encodeURIComponent(versionA)}&versionB=${encodeURIComponent(versionB)}`,
    );
  }

  // ── Inline execution ──────────────────────────────────────────────────────

  /**
   * Score pre-computed agent outputs.
   * Built-in metrics are evaluated server-side; custom metric scores you
   * computed locally are merged in and persisted alongside them.
   */
  async executeInline(runId: string, outputs: InlineOutput[]): Promise<InlineExecuteResponse> {
    const normalized = outputs.map((output) => ({
      exampleId: output.exampleId,
      generatedOutput: output.generatedOutput,
      agentOutput: output.generatedOutput,
      actualTools: output.actualTools,
      metadata: output.metadata,
      customMetrics: output.customMetrics ?? [],
    }));

    return this.post<InlineExecuteResponse>(
      `/evaluation/runs/${runId}/execute-inline`,
      { outputs: normalized },
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const url = `${this.base}${path}`;
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    return this.parse<T>(res, url);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.base}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, url);
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.base}${path}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res, url);
  }

  private async parse<T>(res: Response, url: string): Promise<T> {
    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      parsed = undefined;
    }

    if (!res.ok) {
      let msg = text;
      if (parsed && typeof parsed === 'object') {
        const body = parsed as {
          error?: string;
          report?: { issues?: Array<{ severity?: string; message?: string }> };
        };
        msg = body.error ?? text;
        const firstIssue = body.report?.issues?.[0];
        if (firstIssue?.message) {
          const sev = firstIssue.severity ? `${firstIssue.severity}: ` : '';
          msg = `${msg} (${sev}${firstIssue.message})`;
        }
      }
      throw new EvalClientError(res.status, msg, url, parsed);
    }

    return parsed as T;
  }
}
