import type {
  BuiltInMetricsConfig,
  EvalDatasetRow,
  EvalExampleRow,
  EvalRunRow,
  InlineExecuteResponse,
  InlineOutput,
} from './types';

// ─── Error ────────────────────────────────────────────────────────────────────

export class EvalClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly url: string,
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
  async findOrCreateDataset(name: string, description = ''): Promise<string> {
    const { datasets } = await this.get<{ datasets: EvalDatasetRow[] }>('/evaluation/datasets');
    const existing = datasets.find((d) => d.name === name);
    if (existing) return existing.id;

    const created = await this.post<EvalDatasetRow>('/evaluation/datasets', { name, description });
    return created.id;
  }

  async listDatasets(): Promise<EvalDatasetRow[]> {
    const { datasets } = await this.get<{ datasets: EvalDatasetRow[] }>('/evaluation/datasets');
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
    examples: Array<{ input: string; goldenOutput: string; metadata?: Record<string, string> }>,
  ): Promise<string[]> {
    const { examples: rows } = await this.post<{ count: number; examples: EvalExampleRow[] }>(
      `/evaluation/datasets/${datasetId}/examples`,
      { examples },
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

  // ── Inline execution ──────────────────────────────────────────────────────

  /**
   * Score pre-computed agent outputs.
   * Built-in metrics are evaluated server-side; custom metric scores you
   * computed locally are merged in and persisted alongside them.
   */
  async executeInline(runId: string, outputs: InlineOutput[]): Promise<InlineExecuteResponse> {
    return this.post<InlineExecuteResponse>(
      `/evaluation/runs/${runId}/execute-inline`,
      { outputs },
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

  private async parse<T>(res: Response, url: string): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = (JSON.parse(text) as { error?: string }).error ?? text; } catch { /* raw */ }
      throw new EvalClientError(res.status, msg, url);
    }
    return JSON.parse(text) as T;
  }
}
