import { generateText } from 'ai';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { evalSuite } from '@qwery/tracing-sdk/eval';
import { mustacheImpactExecutionDataset } from '../../datasets/single-turn/mustache-impact-execution.dataset';
import type { QueryResults } from '../../../src/agents/tools/generate-chart';
import { SELECT_CHART_TYPE_PROMPT } from '../../../src/agents/prompts/select-chart-type.prompt';
import { GENERATE_CHART_CONFIG_PROMPT } from '../../../src/agents/prompts/generate-chart-config.prompt';
import { resolveModel } from '../../../src/services';

type GroundTruthSpec = {
  selectedChartType: 'bar' | 'line' | 'pie';
  finalChartType: 'bar' | 'line' | 'pie';
  config: {
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  };
  svgMustContain?: string[];
  minDataLength: number;
};

type SuiteOutput = {
  ok: boolean;
  stage?: 'selectChartType' | 'generateChart' | 'renderChartSvg';
  error?: string;
  scenario: string;
  sizeBucket: string;
  rowCount: number;
  queryResultChars: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  selectPromptChars: number;
  configPromptChars: number;
  promptChars: number;
  selectionInputTokens: number;
  selectionOutputTokens: number;
  selectionLatencyMs: number;
  configInputTokens: number;
  configOutputTokens: number;
  configLatencyMs: number;
  selection?: {
    chartType: 'bar' | 'line' | 'pie';
    reasoningText: string;
  };
  chart?: {
    chartType: 'bar' | 'line' | 'pie';
    dataLength: number;
    config: {
      colors: string[];
      labels?: Record<string, string>;
      xKey?: string;
      yKey?: string;
      nameKey?: string;
      valueKey?: string;
    };
  };
  svg?: string;
};

type SnapshotCase = {
  id: string;
  scenario: string | null;
  sizeBucket: string | null;
  rowCount: number | null;
  queryResultChars: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  score: number;
  passed: boolean;
};

const ChartTypeSchema = z.enum(['bar', 'line', 'pie']);

const ChartTypeSelectionSchema = z.object({
  chartType: ChartTypeSchema,
  reasoningText: z.string(),
});

const ChartConfigTemplateSchema = z.object({
  chartType: ChartTypeSchema,
  title: z.string().optional(),
  config: z.object({
    colors: z.array(z.string()),
    labels: z.record(z.string(), z.string()).optional(),
    xKey: z.string().optional(),
    yKey: z.string().optional(),
    nameKey: z.string().optional(),
    valueKey: z.string().optional(),
  }),
});

const ChartConfigSchema = z.object({
  chartType: ChartTypeSchema,
  title: z.string().optional(),
  data: z.array(z.record(z.string(), z.unknown())),
  config: z.object({
    colors: z.array(z.string()),
    labels: z.record(z.string(), z.string()).optional(),
    xKey: z.string().optional(),
    yKey: z.string().optional(),
    nameKey: z.string().optional(),
    valueKey: z.string().optional(),
  }),
});

const SVG_W = 600;
const SVG_H = 360;

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderChartSvgLocal(
  chartType: 'bar' | 'line' | 'pie',
  data: Array<Record<string, unknown>>,
  config: {
    labels?: Record<string, string>;
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  },
): string {
  if (!data.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}"><text x="300" y="180">empty</text></svg>`;
  }

  if (chartType === 'pie') {
    const nameKey = config.nameKey ?? Object.keys(data[0] ?? {})[0] ?? 'name';
    const valueKey = config.valueKey ?? Object.keys(data[0] ?? {})[1] ?? 'value';
    const legend = data
      .slice(0, 8)
      .map(
        (row, i) =>
          `<text x="40" y="${40 + i * 18}" font-size="12">${esc(row[nameKey])}: ${esc(row[valueKey])}</text>`,
      )
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
      <text x="300" y="24" text-anchor="middle">${esc(config.labels?.[nameKey] ?? nameKey)}</text>
      ${legend}
    </svg>`;
  }

  const xKey = config.xKey ?? Object.keys(data[0] ?? {})[0] ?? 'x';
  const yKey = config.yKey ?? Object.keys(data[0] ?? {})[1] ?? 'y';
  const labels = data
    .slice(0, 10)
    .map(
      (row, i) =>
        `<text x="${60 + i * 50}" y="330" font-size="10">${esc(row[xKey])}</text>`,
    )
    .join('');
  const values = data
    .slice(0, 10)
    .map(
      (row, i) =>
        chartType === 'line'
          ? `<circle cx="${60 + i * 50}" cy="${240 - (Number(row[yKey]) % 140)}" r="4"></circle>`
          : `<rect x="${50 + i * 50}" y="${240 - (Number(row[yKey]) % 140)}" width="20" height="${Math.max(12, Number(row[yKey]) % 140)}"></rect>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_W}" height="${SVG_H}" viewBox="0 0 ${SVG_W} ${SVG_H}">
    <text x="300" y="24" text-anchor="middle">${esc(config.labels?.[xKey] ?? xKey)}</text>
    <text x="20" y="180" transform="rotate(-90,20,180)">${esc(config.labels?.[yKey] ?? yKey)}</text>
    ${values}
    ${labels}
  </svg>`;
}

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

function applyModelEnv(modelString: string): void {
  const [provider, ...rest] = modelString.split('/');
  const modelName = rest.join('/');
  if (!provider || !modelName) return;
  process.env.AGENT_PROVIDER = process.env.AGENT_PROVIDER ?? provider;
  if (provider === 'ollama' || provider === 'ollama-cloud') {
    process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? modelName;
  } else if (provider === 'azure') {
    process.env.AZURE_OPENAI_DEPLOYMENT =
      process.env.AZURE_OPENAI_DEPLOYMENT ?? modelName;
  } else if (provider === 'anthropic') {
    process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? modelName;
  } else if (provider === 'transformer' || provider === 'transformer-browser') {
    process.env.TRANSFORMER_MODEL = process.env.TRANSFORMER_MODEL ?? modelName;
  } else if (provider === 'webllm') {
    process.env.WEBLLM_MODEL = process.env.WEBLLM_MODEL ?? modelName;
  }
}

applyModelEnv(MODEL);
const model = await resolveModel(MODEL);

function phrase(seed: string, i: number, large = false): string {
  return large
    ? `${seed} ${i} with planning context, variance commentary, channel notes, customer-segment interpretation, and executive follow-up actions`
    : `${seed} ${i} with concise business context`;
}

function buildBarRows(count: number, large = false) {
  return Array.from({ length: count }, (_, i) => ({
    region: ['North', 'South', 'East', 'West', 'Central', 'LATAM'][i % 6],
    total_revenue: 10000 + (i % 240) * 137,
    country: `Country ${i % 18}`,
    sales_channel: ['Direct', 'Partner', 'Online', 'Retail'][i % 4],
    account_manager: `Manager ${i % 21}`,
    customer_tier: ['Strategic', 'Growth', 'SMB'][i % 3],
    pipeline_stage: ['Committed', 'Upside', 'Open'][i % 3],
    fiscal_period: `FY2026-Q${(i % 4) + 1}`,
    narrative: phrase('Regional revenue explanation', i, large),
    commentary: phrase('Quarterly planning note', i + 4, large),
  }));
}

function buildLineRows(count: number, large = false) {
  return Array.from({ length: count }, (_, i) => ({
    month: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
    total_revenue: 12000 + (i % 320) * 113,
    returning_customers: 400 + (i % 70),
    new_customers: 140 + (i % 55),
    marketing_spend: 2500 + (i % 90) * 22,
    operating_region: ['North', 'South', 'East', 'West'][i % 4],
    campaign_theme: `Theme ${i % 9}`,
    notes: phrase('Monthly trend note', i, large),
    executive_summary: phrase('Revenue review summary', i + 7, large),
    planning_bucket: ['Baseline', 'Stretch', 'Recovery'][i % 3],
  }));
}

function buildPieRows(count: number, large = false) {
  return Array.from({ length: count }, (_, i) => ({
    region: ['North', 'South', 'East', 'West', 'Central'][i % 5],
    share_pct: Number((((i % 25) + 1) / 27).toFixed(4)),
    segment: ['Commercial', 'Enterprise', 'Public'][i % 3],
    sponsoring_team: `Team ${i % 10}`,
    allocation_note: phrase('Share allocation rationale', i, large),
    renewal_risk: ['low', 'medium', 'high'][i % 3],
    parent_group: `Parent Group ${i % 8}`,
    benchmark_label: `Benchmark ${i % 6}`,
    score_band: ['A', 'B', 'C'][i % 3],
    commentary: phrase('Portfolio mix commentary', i + 3, large),
  }));
}

const SCENARIOS: Record<
  string,
  {
    sizeBucket: 'small' | 'large';
    sqlQuery: string;
    queryResults: QueryResults;
  }
> = {
  bar_small: {
    sizeBucket: 'small',
    sqlQuery:
      'SELECT region, total_revenue, country, sales_channel, account_manager, customer_tier, pipeline_stage, fiscal_period, narrative, commentary FROM sales_rollup ORDER BY total_revenue DESC',
    queryResults: {
      columns: [
        'region',
        'total_revenue',
        'country',
        'sales_channel',
        'account_manager',
        'customer_tier',
        'pipeline_stage',
        'fiscal_period',
        'narrative',
        'commentary',
      ],
      rows: buildBarRows(12, false),
    },
  },
  bar_large: {
    sizeBucket: 'large',
    sqlQuery:
      'SELECT region, total_revenue, country, sales_channel, account_manager, customer_tier, pipeline_stage, fiscal_period, narrative, commentary FROM sales_rollup ORDER BY total_revenue DESC',
    queryResults: {
      columns: [
        'region',
        'total_revenue',
        'country',
        'sales_channel',
        'account_manager',
        'customer_tier',
        'pipeline_stage',
        'fiscal_period',
        'narrative',
        'commentary',
      ],
      rows: buildBarRows(1200, true),
    },
  },
  line_small: {
    sizeBucket: 'small',
    sqlQuery:
      'SELECT month, total_revenue, returning_customers, new_customers, marketing_spend, operating_region, campaign_theme, notes, executive_summary, planning_bucket FROM revenue_trend ORDER BY month',
    queryResults: {
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
      rows: buildLineRows(18, false),
    },
  },
  line_large: {
    sizeBucket: 'large',
    sqlQuery:
      'SELECT month, total_revenue, returning_customers, new_customers, marketing_spend, operating_region, campaign_theme, notes, executive_summary, planning_bucket FROM revenue_trend ORDER BY month',
    queryResults: {
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
      rows: buildLineRows(1500, true),
    },
  },
  pie_small: {
    sizeBucket: 'small',
    sqlQuery:
      'SELECT region, share_pct, segment, sponsoring_team, allocation_note, renewal_risk, parent_group, benchmark_label, score_band, commentary FROM portfolio_mix ORDER BY share_pct DESC',
    queryResults: {
      columns: [
        'region',
        'share_pct',
        'segment',
        'sponsoring_team',
        'allocation_note',
        'renewal_risk',
        'parent_group',
        'benchmark_label',
        'score_band',
        'commentary',
      ],
      rows: buildPieRows(10, false),
    },
  },
  pie_large: {
    sizeBucket: 'large',
    sqlQuery:
      'SELECT region, share_pct, segment, sponsoring_team, allocation_note, renewal_risk, parent_group, benchmark_label, score_band, commentary FROM portfolio_mix ORDER BY share_pct DESC',
    queryResults: {
      columns: [
        'region',
        'share_pct',
        'segment',
        'sponsoring_team',
        'allocation_note',
        'renewal_risk',
        'parent_group',
        'benchmark_label',
        'score_band',
        'commentary',
      ],
      rows: buildPieRows(900, true),
    },
  },
};

function parseSpec(text: string): GroundTruthSpec {
  return JSON.parse(text) as GroundTruthSpec;
}

function parseOutput(text: string): SuiteOutput | null {
  try {
    return JSON.parse(text) as SuiteOutput;
  } catch {
    return null;
  }
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function extractJsonObject(text: string): string {
  const normalized = stripFence(text);
  const firstBrace = normalized.indexOf('{');
  const lastBrace = normalized.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return normalized.slice(firstBrace, lastBrace + 1);
  }
  return normalized;
}

function guessCategoryKey(columns: string[]): string | undefined {
  return (
    columns.find((key) => {
      const lower = key.toLowerCase();
      return (
        lower.includes('name') ||
        lower.includes('category') ||
        lower.includes('label') ||
        lower.includes('region') ||
        lower.includes('month')
      );
    }) ?? columns[0]
  );
}

function guessValueKey(columns: string[], excludeKey?: string): string | undefined {
  return (
    columns.find((key) => {
      if (excludeKey && key === excludeKey) return false;
      const lower = key.toLowerCase();
      return (
        lower.includes('value') ||
        lower.includes('count') ||
        lower.includes('amount') ||
        lower.includes('revenue') ||
        lower.includes('share')
      );
    }) ??
    columns.find((key) => key !== excludeKey) ??
    columns[0]
  );
}

function evaluateChartDataLocal(
  chartType: 'bar' | 'line' | 'pie',
  queryResults: QueryResults,
  config: {
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  },
): Array<Record<string, unknown>> {
  const { rows, columns } = queryResults;
  if (!rows?.length) return [];

  if (chartType === 'bar' || chartType === 'line') {
    const xKey = config.xKey ?? guessCategoryKey(columns);
    const yKey = config.yKey ?? guessValueKey(columns, xKey);
    if (!xKey || !yKey) return [];
    return rows.map((row) => {
      const typed = row as Record<string, unknown>;
      return { [xKey]: typed[xKey], [yKey]: typed[yKey] };
    });
  }

  const nameKey = config.nameKey ?? guessCategoryKey(columns);
  const valueKey = config.valueKey ?? guessValueKey(columns, nameKey);
  if (!nameKey || !valueKey) return [];
  return rows.map((row) => {
    const typed = row as Record<string, unknown>;
    return { [nameKey]: typed[nameKey], [valueKey]: typed[valueKey] };
  });
}

function pickRelevantConfig(config: NonNullable<SuiteOutput['chart']>['config']) {
  const result: Record<string, string> = {};
  for (const key of ['xKey', 'yKey', 'nameKey', 'valueKey'] as const) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) {
      result[key] = value;
    }
  }
  return result;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * (sorted.length - 1))),
  );
  return sorted[idx] ?? 0;
}

function isSuccess(parsed: SuiteOutput | null): parsed is SuiteOutput & { ok: true } {
  return !!parsed && parsed.ok === true;
}

const goldens = await mustacheImpactExecutionDataset.pull({ local: true });

const result = await evalSuite('Mustache Impact Execution', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: mustacheImpactExecutionDataset.name,
  agentVersion: process.env.AGENT_VERSION ?? MODEL,
  metrics: { overall: [] },
  cases: goldens.map((g) => {
    const scenarioId = String(g.metadata?.scenario ?? '');
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) {
      throw new Error(`Missing mustache impact scenario for ${g.id}`);
    }

    return {
      ...g,
      agent: async (input: string) => {
        const rowCount = scenario.queryResults.rows.length;
        const queryResultChars = JSON.stringify(scenario.queryResults.rows).length;
        const startedAt = Date.now();

        const selectPrompt = SELECT_CHART_TYPE_PROMPT(
          input,
          scenario.sqlQuery,
          scenario.queryResults as never,
          null,
        );
        const selectStartedAt = Date.now();

        try {
          const selectionResponse = await generateText({
            model,
            prompt: selectPrompt,
          });
          const selectionLatencyMs = Date.now() - selectStartedAt;
          const parsedSelection = JSON.parse(extractJsonObject(selectionResponse.text)) as {
            chartType: 'bar' | 'line' | 'pie';
            reasoningText?: string;
            reasoning?: string;
          };
          const selection = ChartTypeSelectionSchema.parse({
            chartType: parsedSelection.chartType,
            reasoningText:
              parsedSelection.reasoningText ?? parsedSelection.reasoning ?? '',
          });

          const configPrompt = GENERATE_CHART_CONFIG_PROMPT(
            selection.chartType,
            scenario.queryResults as never,
            scenario.sqlQuery,
            null,
          );
          const configStartedAt = Date.now();

          const configResponse = await generateText({
            model,
            prompt: configPrompt,
          });
          const configLatencyMs = Date.now() - configStartedAt;

          const template = ChartConfigTemplateSchema.parse(
            JSON.parse(extractJsonObject(configResponse.text)),
          );

          const data = evaluateChartDataLocal(
            selection.chartType,
            scenario.queryResults,
            template.config,
          );

          const chart = ChartConfigSchema.parse({
            chartType: template.chartType,
            title: template.title,
            data,
            config: template.config,
          });

          const svg = renderChartSvgLocal(chart.chartType, chart.data, chart.config);

          return JSON.stringify({
            ok: true,
            scenario: scenarioId,
            sizeBucket: scenario.sizeBucket,
            rowCount,
            queryResultChars,
            inputTokens:
              (selectionResponse.usage?.inputTokens ?? 0) +
              (configResponse.usage?.inputTokens ?? 0),
            outputTokens:
              (selectionResponse.usage?.outputTokens ?? 0) +
              (configResponse.usage?.outputTokens ?? 0),
            latencyMs: Date.now() - startedAt,
            selectPromptChars: selectPrompt.length,
            configPromptChars: configPrompt.length,
            promptChars: selectPrompt.length + configPrompt.length,
            selectionInputTokens: selectionResponse.usage?.inputTokens ?? 0,
            selectionOutputTokens: selectionResponse.usage?.outputTokens ?? 0,
            selectionLatencyMs,
            configInputTokens: configResponse.usage?.inputTokens ?? 0,
            configOutputTokens: configResponse.usage?.outputTokens ?? 0,
            configLatencyMs,
            selection,
            chart: {
              chartType: chart.chartType,
              dataLength: chart.data.length,
              config: chart.config,
            },
            svg,
          } satisfies SuiteOutput);
        } catch (error) {
          return JSON.stringify({
            ok: false,
            scenario: scenarioId,
            sizeBucket: scenario.sizeBucket,
            rowCount,
            queryResultChars,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: Date.now() - startedAt,
            selectPromptChars: selectPrompt.length,
            configPromptChars: 0,
            promptChars: selectPrompt.length,
            selectionInputTokens: 0,
            selectionOutputTokens: 0,
            selectionLatencyMs: 0,
            configInputTokens: 0,
            configOutputTokens: 0,
            configLatencyMs: 0,
            stage: /render/i.test(String(error))
              ? 'renderChartSvg'
              : /config/i.test(String(error))
                ? 'generateChart'
                : 'selectChartType',
            error: error instanceof Error ? error.message : String(error),
          } satisfies SuiteOutput);
        }
      },
      customMetrics: [
        {
          name: 'pipeline_completed',
          fn: (out) => (isSuccess(parseOutput(out)) ? 1 : 0),
        },
        {
          name: 'selected_chart_type_match',
          fn: (out, groundTruth) => {
            const parsed = parseOutput(out);
            const spec = parseSpec(groundTruth);
            return parsed?.selection?.chartType === spec.selectedChartType ? 1 : 0;
          },
        },
        {
          name: 'final_chart_type_match',
          fn: (out, groundTruth) => {
            const parsed = parseOutput(out);
            const spec = parseSpec(groundTruth);
            return isSuccess(parsed) && parsed.chart.chartType === spec.finalChartType
              ? 1
              : 0;
          },
        },
        {
          name: 'config_key_match',
          fn: (out, groundTruth) => {
            const parsed = parseOutput(out);
            const spec = parseSpec(groundTruth);
            if (!isSuccess(parsed)) return 0;
            const actual = pickRelevantConfig(parsed.chart.config);
            const expected = Object.fromEntries(
              Object.entries(spec.config).filter(([, value]) => !!value),
            ) as Record<string, string>;
            const keys = Object.keys(expected);
            if (!keys.length) return 1;
            const matched = keys.filter((key) => actual[key] === expected[key]).length;
            return matched / keys.length;
          },
        },
        {
          name: 'data_length_match',
          fn: (out, groundTruth) => {
            const parsed = parseOutput(out);
            const spec = parseSpec(groundTruth);
            return isSuccess(parsed) && parsed.chart.dataLength >= spec.minDataLength ? 1 : 0;
          },
        },
        {
          name: 'svg_valid',
          fn: (out) => {
            const parsed = parseOutput(out);
            return isSuccess(parsed) &&
              typeof parsed.svg === 'string' &&
              parsed.svg.includes('<svg') &&
              parsed.svg.includes('</svg>')
              ? 1
              : 0;
          },
        },
        {
          name: 'svg_contains_expected_content',
          fn: (out, groundTruth) => {
            const parsed = parseOutput(out);
            const spec = parseSpec(groundTruth);
            if (!isSuccess(parsed)) return 0;
            const required = spec.svgMustContain ?? [];
            if (!required.length) return 1;
            const lower = parsed.svg?.toLowerCase() ?? '';
            const matched = required.filter((item) =>
              lower.includes(item.toLowerCase()),
            ).length;
            return matched / required.length;
          },
        },
      ],
    };
  }),
});

const payloads = result.results
  .map((entry) => parseOutput(entry.generatedOutput))
  .filter((entry): entry is SuiteOutput => !!entry);

const inputTokens = payloads
  .map((entry) => entry.inputTokens)
  .filter((value) => typeof value === 'number');
const outputTokens = payloads
  .map((entry) => entry.outputTokens)
  .filter((value) => typeof value === 'number');
const latencies = payloads
  .map((entry) => entry.latencyMs)
  .filter((value) => typeof value === 'number');

if (payloads.length > 0) {
  const cases: SnapshotCase[] = result.results.map((entry) => {
    const parsed = parseOutput(entry.generatedOutput);
    return {
      id: entry.id,
      scenario: parsed?.scenario ?? null,
      sizeBucket: parsed?.sizeBucket ?? null,
      rowCount: parsed?.rowCount ?? null,
      queryResultChars: parsed?.queryResultChars ?? null,
      inputTokens: parsed?.inputTokens ?? null,
      outputTokens: parsed?.outputTokens ?? null,
      latencyMs: parsed?.latencyMs ?? null,
      score: entry.score,
      passed: entry.passed,
    };
  });
  const qualityScores = cases.map((entry) => entry.score);
  const snapshot = {
    createdAt: new Date().toISOString(),
    datasetName: mustacheImpactExecutionDataset.name,
    model: MODEL,
    agentVersion: process.env.AGENT_VERSION ?? MODEL,
    runId: result.runId,
    summary: result.summary,
    metrics: {
      sampleCount: payloads.length,
      avgPromptTokens:
        inputTokens.reduce((sum, value) => sum + value, 0) / inputTokens.length,
      p95PromptTokens: percentile(inputTokens, 95),
      avgOutputTokens:
        outputTokens.reduce((sum, value) => sum + value, 0) / outputTokens.length,
      p95OutputTokens: percentile(outputTokens, 95),
      avgLatencyMs:
        latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      p95LatencyMs: percentile(latencies, 95),
      avgQualityScore:
        qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length,
      p95QualityScore: percentile(qualityScores, 95),
    },
    cases,
  };

  const outDir = resolve(
    process.cwd(),
    'evals-regression',
    'reports',
    'mustache-token-runs',
  );
  mkdirSync(outDir, { recursive: true });
  const safeVersion = (process.env.AGENT_VERSION ?? MODEL).replace(
    /[^a-zA-Z0-9._-]/g,
    '_',
  );
  const outPath = resolve(outDir, `mustache-token-${safeVersion}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');

  console.log('');
  console.log('─── Mustache Impact Execution Insights ──────────────────────────');
  console.log(`Samples parsed: ${payloads.length}/${result.results.length}`);
  console.log(
    `Input tokens avg: ${Math.round(snapshot.metrics.avgPromptTokens)} | p95: ${Math.round(snapshot.metrics.p95PromptTokens)}`,
  );
  console.log(
    `Output tokens avg: ${Math.round(snapshot.metrics.avgOutputTokens)} | p95: ${Math.round(snapshot.metrics.p95OutputTokens)}`,
  );
  console.log(
    `Latency avg ms: ${Math.round(snapshot.metrics.avgLatencyMs)} | p95: ${Math.round(snapshot.metrics.p95LatencyMs)}`,
  );
  console.log(`Snapshot: ${outPath}`);
  console.log('──────────────────────────────────────────────────────────────────');
}
