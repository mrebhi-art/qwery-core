import { computeAllMetrics } from '../../domain/evaluation';
import type {
  EvaluationMetricsConfig,
  MetricResult,
  ChartMetricName,
} from '../../domain/evaluation';
import type { TraceRepository } from '../../domain/ports/trace-repository.port';
import type { TraceId, Artifact, Trace } from '../../domain/trace';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EvaluateTraceItem = {
  traceId: string;
  /** Expected overall / text output (also used as fallback for SQL/tool if specific golden not supplied). */
  goldenOutput?: string;
  /** Expected SQL query — drives sql_* metrics. */
  goldenSql?: string;
  /** Expected SVG or chart config — drives chart_* comparison metrics. */
  goldenChart?: string;
  /** Expected tool calls JSON array — drives tool_* metrics. */
  goldenTool?: string;
};

export type EvaluateTracesDirectlyCommand = {
  apiKey: string;
  items: EvaluateTraceItem[];
  metrics: EvaluationMetricsConfig;
};

export type TraceEvalResult = {
  traceId: string;
  inputPreview: string;
  agentOutput: string;
  goldenOutput: string;
  metrics: MetricResult[];
  score: number;        // average of all metric scores (0–1)
  passed: boolean;
  error?: string;
};

export type EvaluateTracesDirectlyResult = {
  results: TraceEvalResult[];
  summary: {
    total: number;
    passed: number;
    avgScore: number;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stringify(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Extract tool-call steps from the trace as JSON for comparison. */
function extractToolOutput(trace: Trace): string {
  const toolSteps = trace.steps.filter((s) => s.type === 'tool_call');
  if (toolSteps.length === 0) return stringify(trace.output);
  return JSON.stringify(
    toolSteps.map((s) => ({ name: s.name, args: s.input, output: s.output })),
  );
}

/** Chart metrics that validate the output itself and do NOT need a golden output. */
const CHART_VALIDATION_METRICS: ChartMetricName[] = ['chart_svg_valid', 'chart_data_present'];

/**
 * Run all selected metric categories against the appropriate trace artifacts.
 * Categories without a matching golden input are skipped (comparison metrics only).
 */
async function evaluateSingle(
  trace: Trace,
  item: EvaluateTraceItem,
  metrics: EvaluationMetricsConfig,
): Promise<{ metrics: MetricResult[]; agentOutput: string }> {
  const allArtifacts: Artifact[] = trace.steps.flatMap((s) => Array.from(s.artifacts));
  const artifactSummary = allArtifacts.length > 0
    ? allArtifacts.map((a) => `${a.type}(${a.mimeType})`).join(', ')
    : `none — ${trace.steps.length} step(s) with no artifacts`;
  const collected: MetricResult[] = [];
  // Track the primary artifact content actually used for evaluation (for the output diff)
  let primaryAgentOutput: string | null = null;

  // ── SQL ───────────────────────────────────────────────────────────────────
  if (metrics.sql.length > 0) {
    // 1. Prefer a dedicated sql artifact
    // 2. Fall back to any step output that looks like SQL
    const sqlArtifact =
      allArtifacts.find((a) => a.type === 'sql') ??
      allArtifacts.find((a) => /text\/(sql|plain)/.test(a.mimeType) && /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE)/i.test(a.data));

    const sqlFromStepOutput = !sqlArtifact
      ? trace.steps
          .map((s) => {
            const o = stringify(s.output);
            return /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE)/i.test(o) ? o : null;
          })
          .find(Boolean) ?? null
      : null;

    const agentSql = sqlArtifact?.data ?? sqlFromStepOutput;

    if (!agentSql) {
      metrics.sql.forEach((m) =>
        collected.push({ metric: m, category: 'sql', score: 0, passed: false, detail: `no SQL artifact in trace (found: ${artifactSummary})` }),
      );
    } else {
      primaryAgentOutput ??= agentSql;
      const golden = item.goldenSql ?? item.goldenOutput ?? '';
      if (golden) {
        collected.push(
          ...computeAllMetrics({ goldenOutput: golden, agentOutput: agentSql, config: { sql: metrics.sql, chart: [], tool: [], overall: [] } }),
        );
      }
    }
  }

  // ── Chart ─────────────────────────────────────────────────────────────────
  if (metrics.chart.length > 0) {
    // 1. Prefer a dedicated chart artifact or explicit SVG mime type
    // 2. Fall back to any artifact that contains an SVG string
    // 3. Fall back to any step output that contains SVG
    const chartArtifact =
      allArtifacts.find((a) => a.type === 'chart') ??
      allArtifacts.find((a) => a.mimeType === 'image/svg+xml') ??
      allArtifacts.find((a) => /<svg[\s>]/i.test(a.data));

    const svgFromStepOutput = !chartArtifact
      ? trace.steps
          .map((s) => {
            const o = stringify(s.output);
            return /<svg[\s>]/i.test(o) ? o : null;
          })
          .find(Boolean) ?? null
      : null;

    const agentSvg = chartArtifact?.data ?? svgFromStepOutput;

    if (!agentSvg) {
      metrics.chart.forEach((m) =>
        collected.push({ metric: m, category: 'chart', score: 0, passed: false, detail: `no chart/SVG artifact in trace (found: ${artifactSummary})` }),
      );
    } else {
      primaryAgentOutput ??= agentSvg;
      // Metrics that only inspect the agent output (no golden needed)
      const validationOnly = metrics.chart.filter((n) =>
        (CHART_VALIDATION_METRICS as string[]).includes(n),
      ) as ChartMetricName[];
      if (validationOnly.length > 0) {
        collected.push(
          ...computeAllMetrics({ goldenOutput: '', agentOutput: agentSvg, config: { sql: [], chart: validationOnly, tool: [], overall: [] } }),
        );
      }

      // Metrics that compare against a golden chart / SVG
      const comparisonMetrics = metrics.chart.filter(
        (n) => !(CHART_VALIDATION_METRICS as string[]).includes(n),
      ) as ChartMetricName[];
      const goldenChart = item.goldenChart ?? '';
      if (comparisonMetrics.length > 0 && goldenChart) {
        collected.push(
          ...computeAllMetrics({ goldenOutput: goldenChart, agentOutput: agentSvg, config: { sql: [], chart: comparisonMetrics, tool: [], overall: [] } }),
        );
      }
    }
  }

  // ── Tool ──────────────────────────────────────────────────────────────────
  if (metrics.tool.length > 0) {
    const golden = item.goldenTool ?? '';
    if (golden) {
      collected.push(
        ...computeAllMetrics({ goldenOutput: golden, agentOutput: extractToolOutput(trace), config: { sql: [], chart: [], tool: metrics.tool, overall: [] } }),
      );
    }
  }

  // ── Overall ───────────────────────────────────────────────────────────────
  if (metrics.overall.length > 0) {
    const golden = item.goldenOutput ?? '';
    if (golden) {
      collected.push(
        ...computeAllMetrics({ goldenOutput: golden, agentOutput: stringify(trace.output), config: { sql: [], chart: [], tool: [], overall: metrics.overall } }),
      );
    }
  }

  return { metrics: collected, agentOutput: primaryAgentOutput ?? stringify(trace.output) };
}

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class EvaluateTracesDirectlyUseCase {
  constructor(private readonly traceRepository: TraceRepository) {}

  async execute(command: EvaluateTracesDirectlyCommand): Promise<EvaluateTracesDirectlyResult> {
    const results: TraceEvalResult[] = [];

    for (const item of command.items) {
      try {
        const trace = await this.traceRepository.findById(item.traceId as TraceId, command.apiKey);
        if (!trace) {
          results.push({
            traceId: item.traceId,
            inputPreview: '',
            agentOutput: '',
            goldenOutput: item.goldenOutput ?? item.goldenSql ?? item.goldenChart ?? item.goldenTool ?? '',
            metrics: [],
            score: 0,
            passed: false,
            error: 'Trace not found',
          });
          continue;
        }

        const { metrics, agentOutput } = await evaluateSingle(trace, item, command.metrics);
        const score =
          metrics.length > 0
            ? metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length
            : 0;

        const displayGolden =
          item.goldenSql ?? item.goldenChart ?? item.goldenOutput ?? item.goldenTool ?? '';

        results.push({
          traceId: item.traceId,
          inputPreview: stringify(trace.input).slice(0, 120),
          agentOutput,
          goldenOutput: displayGolden,
          metrics,
          score: Math.round(score * 100) / 100,
          passed: score >= 0.8,
        });
      } catch (err) {
        results.push({
          traceId: item.traceId,
          inputPreview: '',
          agentOutput: '',
          goldenOutput: '',
          metrics: [],
          score: 0,
          passed: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const passed = results.filter((r) => r.passed).length;
    const avgScore =
      results.length > 0
        ? Math.round((results.reduce((s, r) => s + r.score, 0) / results.length) * 100) / 100
        : 0;

    return {
      results,
      summary: { total: results.length, passed, avgScore },
    };
  }
}
