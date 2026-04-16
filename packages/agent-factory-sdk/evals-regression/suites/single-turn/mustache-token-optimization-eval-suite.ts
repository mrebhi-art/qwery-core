/**
 * Mustache Token Optimization – single-turn eval suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:mustache-token
 */

import { evalSuite } from '@qwery/tracing-sdk/eval';
import { mustacheTokenOptimizationDataset } from '../../datasets/single-turn/mustache-token-optimization.dataset';
import { SELECT_CHART_TYPE_PROMPT } from '../../../src/agents/prompts/select-chart-type.prompt';
import { GENERATE_CHART_CONFIG_PROMPT } from '../../../src/agents/prompts/generate-chart-config.prompt';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';
const AGENT_VERSION = process.env['AGENT_VERSION'] ?? MODEL;

type HarnessPayload = {
  taskId?: string;
  scenario?: string;
  sizeBucket?: string;
  rowCount?: number;
  queryResultChars?: number;
  selectPromptChars?: number;
  configPromptChars?: number;
  promptChars?: number;
  promptTokens?: number;
  latencyMs?: number;
};

type SnapshotCase = {
  id: string;
  scenario: string | null;
  sizeBucket: string | null;
  rowCount: number | null;
  queryResultChars: number | null;
  promptTokens: number | null;
  latencyMs: number | null;
  score: number;
  passed: boolean;
};

function parsePayload(output: string): HarnessPayload | null {
  try {
    const parsed = JSON.parse(output) as HarnessPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

function roughTokenCount(text: string): number {
  const chunks = text.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g);
  return chunks ? chunks.length : 0;
}

function longPhrase(seed: string, index: number, sizeBucket: string) {
  const tail =
    sizeBucket === 'large'
      ? 'with quarterly variance commentary, regional planning notes, and channel-specific operational context'
      : sizeBucket === 'medium'
        ? 'with business context and planning notes'
        : 'with concise context';
  return `${seed} ${index} ${tail}`;
}

function buildBarRows(count: number, sizeBucket: string) {
  return Array.from({ length: count }, (_, i) => ({
    region: `Region ${i % 25}`,
    country: `Country ${i % 12}`,
    sales_channel: ['Enterprise', 'Online', 'Partner', 'Retail'][i % 4],
    account_manager: `Manager ${i % 18}`,
    total_revenue: (i % 97) * 113 + 500,
    gross_margin_pct: Number((0.18 + (i % 11) * 0.03).toFixed(2)),
    pipeline_stage: ['Committed', 'Upside', 'Open'][i % 3],
    customer_tier: ['Strategic', 'Growth', 'SMB'][i % 3],
    narrative: longPhrase('Regional revenue performance summary', i, sizeBucket),
    fiscal_period: `FY2026-Q${(i % 4) + 1}`,
  }));
}

function buildLineRows(count: number, sizeBucket: string) {
  return Array.from({ length: count }, (_, i) => ({
    month: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
    total_revenue: 10000 + (i % 120) * 157,
    returning_customers: 400 + (i % 70),
    new_customers: 120 + (i % 40),
    marketing_spend: 2000 + (i % 90) * 15,
    operating_region: ['North', 'South', 'East', 'West'][i % 4],
    campaign_theme: `Theme ${i % 9}`,
    notes: longPhrase('Monthly trend annotation', i, sizeBucket),
    executive_summary: longPhrase('Finance review commentary', i + 3, sizeBucket),
    planning_bucket: ['Baseline', 'Stretch', 'Recovery'][i % 3],
  }));
}

function buildPieRows(count: number, sizeBucket: string) {
  return Array.from({ length: count }, (_, i) => ({
    region: `Region ${i % 20}`,
    share_pct: Number((((i % 20) + 1) / 23).toFixed(4)),
    segment: ['Commercial', 'Enterprise', 'Public'][i % 3],
    sponsoring_team: `Team ${i % 8}`,
    allocation_note: longPhrase('Share allocation explanation', i, sizeBucket),
    parent_group: `Parent Group ${i % 6}`,
    renewal_risk: ['low', 'medium', 'high'][i % 3],
    score_band: ['A', 'B', 'C'][i % 3],
    benchmark_label: `Benchmark ${i % 5}`,
    commentary: longPhrase('Portfolio mix rationale', i + 2, sizeBucket),
  }));
}

function buildCombinedRows(count: number, sizeBucket: string) {
  return Array.from({ length: count }, (_, i) => ({
    region: `Region ${i % 16}`,
    month: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
    total_revenue: 9000 + (i % 160) * 131,
    bookings: 100 + (i % 60),
    win_rate_pct: Number((0.22 + (i % 9) * 0.04).toFixed(2)),
    sales_channel: ['Direct', 'Partner', 'Online'][i % 3],
    portfolio_owner: `Owner ${i % 14}`,
    commentary: longPhrase('Cross-cutting revenue explanation', i, sizeBucket),
    account_focus: ['Expansion', 'Retention', 'Acquisition'][i % 3],
    planning_note: longPhrase('Forecast planning note', i + 5, sizeBucket),
  }));
}

const SCENARIOS: Record<
  string,
  {
    chartType: 'bar' | 'line' | 'pie';
    sizeBucket: 'small' | 'medium' | 'large';
    rowCount: number;
    sqlQuery: string;
    columns: string[];
    buildRows: (count: number, sizeBucket: string) => Array<Record<string, unknown>>;
  }
> = {
  small_bar_region_revenue: {
    chartType: 'bar',
    sizeBucket: 'small',
    rowCount: 10,
    sqlQuery:
      'SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region ORDER BY total_revenue DESC',
    columns: [
      'region',
      'country',
      'sales_channel',
      'account_manager',
      'total_revenue',
      'gross_margin_pct',
      'pipeline_stage',
      'customer_tier',
      'narrative',
      'fiscal_period',
    ],
    buildRows: buildBarRows,
  },
  medium_bar_region_revenue: {
    chartType: 'bar',
    sizeBucket: 'medium',
    rowCount: 100,
    sqlQuery:
      'SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region ORDER BY total_revenue DESC',
    columns: [
      'region',
      'country',
      'sales_channel',
      'account_manager',
      'total_revenue',
      'gross_margin_pct',
      'pipeline_stage',
      'customer_tier',
      'narrative',
      'fiscal_period',
    ],
    buildRows: buildBarRows,
  },
  large_bar_region_revenue: {
    chartType: 'bar',
    sizeBucket: 'large',
    rowCount: 1000,
    sqlQuery:
      'SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region ORDER BY total_revenue DESC',
    columns: [
      'region',
      'country',
      'sales_channel',
      'account_manager',
      'total_revenue',
      'gross_margin_pct',
      'pipeline_stage',
      'customer_tier',
      'narrative',
      'fiscal_period',
    ],
    buildRows: buildBarRows,
  },
  small_line_monthly_trend: {
    chartType: 'line',
    sizeBucket: 'small',
    rowCount: 12,
    sqlQuery:
      'SELECT month, SUM(revenue) AS total_revenue FROM sales GROUP BY month ORDER BY month',
    columns: [
      'month',
      'total_revenue',
      'returning_customers',
      'new_customers',
      'marketing_spend',
      'operating_region',
      'campaign_theme',
      'notes',
      'executive_summary',
      'planning_bucket',
    ],
    buildRows: buildLineRows,
  },
  medium_line_monthly_trend: {
    chartType: 'line',
    sizeBucket: 'medium',
    rowCount: 120,
    sqlQuery:
      'SELECT month, SUM(revenue) AS total_revenue FROM sales GROUP BY month ORDER BY month',
    columns: [
      'month',
      'total_revenue',
      'returning_customers',
      'new_customers',
      'marketing_spend',
      'operating_region',
      'campaign_theme',
      'notes',
      'executive_summary',
      'planning_bucket',
    ],
    buildRows: buildLineRows,
  },
  large_line_monthly_trend: {
    chartType: 'line',
    sizeBucket: 'large',
    rowCount: 1200,
    sqlQuery:
      'SELECT month, SUM(revenue) AS total_revenue FROM sales GROUP BY month ORDER BY month',
    columns: [
      'month',
      'total_revenue',
      'returning_customers',
      'new_customers',
      'marketing_spend',
      'operating_region',
      'campaign_theme',
      'notes',
      'executive_summary',
      'planning_bucket',
    ],
    buildRows: buildLineRows,
  },
  small_pie_regional_share: {
    chartType: 'pie',
    sizeBucket: 'small',
    rowCount: 8,
    sqlQuery:
      'SELECT region, share_pct FROM revenue_share ORDER BY share_pct DESC',
    columns: [
      'region',
      'share_pct',
      'segment',
      'sponsoring_team',
      'allocation_note',
      'parent_group',
      'renewal_risk',
      'score_band',
      'benchmark_label',
      'commentary',
    ],
    buildRows: buildPieRows,
  },
  medium_pie_regional_share: {
    chartType: 'pie',
    sizeBucket: 'medium',
    rowCount: 80,
    sqlQuery:
      'SELECT region, share_pct FROM revenue_share ORDER BY share_pct DESC',
    columns: [
      'region',
      'share_pct',
      'segment',
      'sponsoring_team',
      'allocation_note',
      'parent_group',
      'renewal_risk',
      'score_band',
      'benchmark_label',
      'commentary',
    ],
    buildRows: buildPieRows,
  },
  large_pie_regional_share: {
    chartType: 'pie',
    sizeBucket: 'large',
    rowCount: 800,
    sqlQuery:
      'SELECT region, share_pct FROM revenue_share ORDER BY share_pct DESC',
    columns: [
      'region',
      'share_pct',
      'segment',
      'sponsoring_team',
      'allocation_note',
      'parent_group',
      'renewal_risk',
      'score_band',
      'benchmark_label',
      'commentary',
    ],
    buildRows: buildPieRows,
  },
  small_combined_breakdown: {
    chartType: 'bar',
    sizeBucket: 'small',
    rowCount: 24,
    sqlQuery:
      'SELECT region, month, SUM(revenue) AS total_revenue FROM sales GROUP BY region, month ORDER BY total_revenue DESC',
    columns: [
      'region',
      'month',
      'total_revenue',
      'bookings',
      'win_rate_pct',
      'sales_channel',
      'portfolio_owner',
      'commentary',
      'account_focus',
      'planning_note',
    ],
    buildRows: buildCombinedRows,
  },
  medium_combined_breakdown: {
    chartType: 'bar',
    sizeBucket: 'medium',
    rowCount: 240,
    sqlQuery:
      'SELECT region, month, SUM(revenue) AS total_revenue FROM sales GROUP BY region, month ORDER BY total_revenue DESC',
    columns: [
      'region',
      'month',
      'total_revenue',
      'bookings',
      'win_rate_pct',
      'sales_channel',
      'portfolio_owner',
      'commentary',
      'account_focus',
      'planning_note',
    ],
    buildRows: buildCombinedRows,
  },
  large_combined_breakdown: {
    chartType: 'bar',
    sizeBucket: 'large',
    rowCount: 2400,
    sqlQuery:
      'SELECT region, month, SUM(revenue) AS total_revenue FROM sales GROUP BY region, month ORDER BY total_revenue DESC',
    columns: [
      'region',
      'month',
      'total_revenue',
      'bookings',
      'win_rate_pct',
      'sales_channel',
      'portfolio_owner',
      'commentary',
      'account_focus',
      'planning_note',
    ],
    buildRows: buildCombinedRows,
  },
};

function renderPromptTask(
  taskId: string,
  input: string,
  scenarioId: string,
  sizeBucket: string,
): string {
  const t0 = Date.now();
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) {
    throw new Error(`Unknown Mustache optimization scenario: ${scenarioId}`);
  }

  const queryResults = {
    rows: scenario.buildRows(scenario.rowCount, scenario.sizeBucket),
    columns: scenario.columns,
    rowCount: scenario.rowCount,
  };

  const selectPrompt = SELECT_CHART_TYPE_PROMPT(
    input,
    scenario.sqlQuery,
    queryResults,
    null,
  );

  const configPrompt = GENERATE_CHART_CONFIG_PROMPT(
    scenario.chartType,
    queryResults,
    scenario.sqlQuery,
    null,
  );

  const promptChars = selectPrompt.length + configPrompt.length;
  const promptTokens = roughTokenCount(selectPrompt) + roughTokenCount(configPrompt);
  const latencyMs = Date.now() - t0;

  return JSON.stringify({
    taskId,
    scenario: scenarioId,
    sizeBucket,
    rowCount: scenario.rowCount,
    queryResultChars: JSON.stringify(queryResults.rows).length,
    selectPromptChars: selectPrompt.length,
    configPromptChars: configPrompt.length,
    promptChars,
    promptTokens,
    latencyMs,
  } satisfies HarnessPayload);
}

const goldens = await mustacheTokenOptimizationDataset.pull({ local: true });

const result = await evalSuite('Mustache Token Optimization', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: mustacheTokenOptimizationDataset.name,
  agentVersion: AGENT_VERSION,
  metrics: { overall: [] },
  cases: goldens.map((g) => ({
    ...g,
    agent: async (input: string) =>
      renderPromptTask(
        g.id,
        input,
        String(g.metadata?.scenario ?? ''),
        String(g.metadata?.sizeBucket ?? ''),
      ),
    customMetrics: [
      {
        name: 'task_executed',
        fn: (out) => {
          const payload = parsePayload(out);
          return payload && typeof payload.taskId === 'string' ? 1 : 0;
        },
      },
      {
        name: 'scenario_bound',
        fn: (out) => {
          const payload = parsePayload(out);
          return payload && typeof payload.scenario === 'string' ? 1 : 0;
        },
      },
      {
        name: 'size_bucket_bound',
        fn: (out) => {
          const payload = parsePayload(out);
          return payload && typeof payload.sizeBucket === 'string' ? 1 : 0;
        },
      },
      {
        name: 'token_efficiency',
        fn: (out) => {
          const payload = parsePayload(out);
          if (!payload || typeof payload.promptTokens !== 'number') return 0;
          const capped = Math.min(Math.max(payload.promptTokens, 0), 30000);
          return 1 - capped / 30000;
        },
      },
      {
        name: 'latency_efficiency',
        fn: (out) => {
          const payload = parsePayload(out);
          if (!payload || typeof payload.latencyMs !== 'number') return 0;
          const capped = Math.min(Math.max(payload.latencyMs, 0), 120000);
          return 1 - capped / 120000;
        },
      },
      {
        name: 'token_budget_8k',
        fn: (out) => {
          const payload = parsePayload(out);
          if (!payload || typeof payload.promptTokens !== 'number') return 0;
          return payload.promptTokens <= 8000 ? 1 : 0;
        },
      },
      {
        name: 'latency_budget_2s',
        fn: (out) => {
          const payload = parsePayload(out);
          if (!payload || typeof payload.latencyMs !== 'number') return 0;
          return payload.latencyMs <= 2000 ? 1 : 0;
        },
      },
    ],
  })),
});

const payloads = result.results
  .map((r) => parsePayload(r.generatedOutput))
  .filter((p): p is HarnessPayload => !!p);

const totals = payloads
  .map((p) => p.promptTokens)
  .filter((v): v is number => typeof v === 'number');
const latencies = payloads
  .map((p) => p.latencyMs)
  .filter((v): v is number => typeof v === 'number');

if (totals.length > 0 && latencies.length > 0) {
  const avgTokens = totals.reduce((a, b) => a + b, 0) / totals.length;
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Tokens = percentile(totals, 95);
  const p95Latency = percentile(latencies, 95);
  const cases: SnapshotCase[] = result.results.map((entry) => {
    const payload = parsePayload(entry.generatedOutput);
    return {
      id: entry.id,
      scenario: typeof payload?.scenario === 'string' ? payload.scenario : null,
      sizeBucket:
        typeof payload?.sizeBucket === 'string' ? payload.sizeBucket : null,
      rowCount:
        typeof payload?.rowCount === 'number' ? payload.rowCount : null,
      queryResultChars:
        typeof payload?.queryResultChars === 'number'
          ? payload.queryResultChars
          : null,
      promptTokens:
        typeof payload?.promptTokens === 'number' ? payload.promptTokens : null,
      latencyMs:
        typeof payload?.latencyMs === 'number' ? payload.latencyMs : null,
      score: entry.score,
      passed: entry.passed,
    };
  });
  const qualityScores = cases.map((entry) => entry.score);
  const avgQualityScore =
    qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length;
  const p95QualityScore = percentile(qualityScores, 95);

  const snapshot = {
    createdAt: new Date().toISOString(),
    datasetName: mustacheTokenOptimizationDataset.name,
    model: MODEL,
    agentVersion: AGENT_VERSION,
    runId: result.runId,
    summary: result.summary,
    metrics: {
      sampleCount: payloads.length,
      avgPromptTokens: avgTokens,
      p95PromptTokens: p95Tokens,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      avgQualityScore,
      p95QualityScore,
    },
    cases,
  };

  const outDir = resolve(process.cwd(), 'evals-regression', 'reports', 'mustache-token-runs');
  mkdirSync(outDir, { recursive: true });
  const safeVersion = AGENT_VERSION.replace(/[^a-zA-Z0-9._-]/g, '_');
  const outPath = resolve(outDir, `mustache-token-${safeVersion}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');

  console.log('');
  console.log('─── Mustache Optimization Insights ──────────────────────────────');
  console.log(`Samples parsed: ${payloads.length}/${result.results.length}`);
  console.log(`Prompt tokens avg: ${Math.round(avgTokens)} | p95: ${Math.round(p95Tokens)}`);
  console.log(`Latency avg ms: ${Math.round(avgLatency)} | p95: ${Math.round(p95Latency)}`);
  console.log(`Snapshot: ${outPath}`);
  console.log('──────────────────────────────────────────────────────────────────');
}

