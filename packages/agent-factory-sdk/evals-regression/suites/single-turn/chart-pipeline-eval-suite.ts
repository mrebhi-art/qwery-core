import { generateText } from 'ai';
import { evalSuite } from '@qwery/tracing-sdk/eval';
import { chartPipelineDataset } from '../../datasets/single-turn/chart-pipeline.dataset';
import type { QueryResults } from '../../../src/agents/tools/generate-chart';
import { buildChartMetadata } from '../../../src/agents/tools/chart-metadata';
import { evaluateChartData } from '../../../src/agents/tools/chart-eval';
import {
  ChartConfigSchema,
  ChartConfigTemplateSchema,
  ChartTypeSelectionSchema,
} from '../../../src/agents/types/chart.types';
import { SELECT_CHART_TYPE_PROMPT } from '../../../src/agents/prompts/select-chart-type.prompt';
import { GENERATE_CHART_CONFIG_PROMPT } from '../../../src/agents/prompts/generate-chart-config.prompt';
import { renderChartSvg } from '../../../src/tools/chart-svg-renderer';
import { resolveModel } from '../../../src/services';

type ChartPipelineSpec = {
  selectedChartType: 'bar' | 'line' | 'pie';
  finalChartType: 'bar' | 'line' | 'pie';
  config: {
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  };
  labels?: Record<string, string>;
  expectedData: Array<Record<string, unknown>>;
  svgMustContain?: string[];
};

type ChartPipelineOutput = {
  ok: true;
  selection: {
    chartType: 'bar' | 'line' | 'pie';
    reasoningText: string;
  };
  chart: {
    chartType: 'bar' | 'line' | 'pie';
    data: Array<Record<string, unknown>>;
    config: {
      colors: string[];
      labels?: Record<string, string>;
      xKey?: string;
      yKey?: string;
      nameKey?: string;
      valueKey?: string;
    };
  };
  svg: string;
};

type ChartPipelineFailure = {
  ok: false;
  stage: 'selectChartType' | 'generateChart' | 'renderChartSvg';
  error: string;
  selection?: {
    chartType: 'bar' | 'line' | 'pie';
    reasoningText: string;
  };
};

type ChartPipelineResult = ChartPipelineOutput | ChartPipelineFailure;

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

function applyModelEnv(modelString: string): void {
  const [provider, ...rest] = modelString.split('/');
  const modelName = rest.join('/');

  if (!provider || !modelName) {
    return;
  }

  process.env.AGENT_PROVIDER = process.env.AGENT_PROVIDER ?? provider;

  if (provider === 'ollama' || provider === 'ollama-cloud') {
    process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? modelName;
    return;
  }

  if (provider === 'azure') {
    process.env.AZURE_OPENAI_DEPLOYMENT =
      process.env.AZURE_OPENAI_DEPLOYMENT ?? modelName;
    return;
  }

  if (provider === 'anthropic') {
    process.env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? modelName;
    return;
  }

  if (provider === 'transformer' || provider === 'transformer-browser') {
    process.env.TRANSFORMER_MODEL =
      process.env.TRANSFORMER_MODEL ?? modelName;
    return;
  }

  if (provider === 'webllm') {
    process.env.WEBLLM_MODEL = process.env.WEBLLM_MODEL ?? modelName;
  }
}

applyModelEnv(MODEL);

const model = await resolveModel(MODEL);

const SCENARIOS: Record<string, { sqlQuery: string; queryResults: QueryResults }> = {
  sales_by_region: {
    sqlQuery:
      'SELECT region, SUM(sales) AS total_sales FROM orders GROUP BY region ORDER BY total_sales DESC',
    queryResults: {
      columns: ['region', 'total_sales'],
      rows: [
        { region: 'North', total_sales: 124000 },
        { region: 'South', total_sales: 118000 },
        { region: 'East', total_sales: 97000 },
        { region: 'West', total_sales: 136000 },
      ],
    },
  },
  monthly_revenue: {
    sqlQuery:
      "SELECT month, SUM(revenue) AS total_revenue FROM sales GROUP BY month ORDER BY month",
    queryResults: {
      columns: ['month', 'total_revenue'],
      rows: [
        { month: '2024-01', total_revenue: 54000 },
        { month: '2024-02', total_revenue: 51000 },
        { month: '2024-03', total_revenue: 60000 },
        { month: '2024-04', total_revenue: 65000 },
      ],
    },
  },
  market_share: {
    sqlQuery: 'SELECT company, share_pct FROM market_share ORDER BY share_pct DESC',
    queryResults: {
      columns: ['company', 'share_pct'],
      rows: [
        { company: 'Apple', share_pct: 45 },
        { company: 'Samsung', share_pct: 30 },
        { company: 'Google', share_pct: 15 },
        { company: 'Others', share_pct: 10 },
      ],
    },
  },
  orders_by_category: {
    sqlQuery:
      'SELECT product_category, COUNT(*) AS order_count FROM orders GROUP BY product_category ORDER BY order_count DESC',
    queryResults: {
      columns: ['product_category', 'order_count'],
      rows: [
        { product_category: 'Electronics', order_count: 42 },
        { product_category: 'Furniture', order_count: 28 },
        { product_category: 'Office Supplies', order_count: 35 },
      ],
    },
  },
  daily_signups: {
    sqlQuery:
      "SELECT day, COUNT(*) AS signup_count FROM signups GROUP BY day ORDER BY day",
    queryResults: {
      columns: ['day', 'signup_count'],
      rows: [
        { day: '2026-04-01', signup_count: 12 },
        { day: '2026-04-02', signup_count: 18 },
        { day: '2026-04-03', signup_count: 15 },
        { day: '2026-04-04', signup_count: 24 },
        { day: '2026-04-05', signup_count: 21 },
      ],
    },
  },
  expense_breakdown: {
    sqlQuery:
      'SELECT category, amount FROM expenses ORDER BY amount DESC',
    queryResults: {
      columns: ['category', 'amount'],
      rows: [
        { category: 'Rent', amount: 3200 },
        { category: 'Payroll', amount: 5400 },
        { category: 'Marketing', amount: 1800 },
        { category: 'Software', amount: 900 },
      ],
    },
  },
};

function parseSpec(text: string): ChartPipelineSpec {
  return JSON.parse(text) as ChartPipelineSpec;
}

function parseOutput(text: string): ChartPipelineResult | null {
  try {
    return JSON.parse(text) as ChartPipelineResult;
  } catch {
    return null;
  }
}

function normalizeRows(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, String(value)]),
      ),
    ),
  );
}

function pickRelevantConfig(config: ChartPipelineOutput['chart']['config']): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['xKey', 'yKey', 'nameKey', 'valueKey'] as const) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) {
      result[key] = value;
    }
  }
  return result;
}

function countSvgMarks(svg: string): number {
  return (svg.match(/<(rect|circle|path|polygon|polyline)\b/gi) ?? []).length;
}

function isSuccess(
  result: ChartPipelineResult | null,
): result is ChartPipelineOutput {
  return !!result && result.ok === true;
}

function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function extractJsonObject(text: string): string {
  const normalized = stripMarkdownCodeFence(text);
  const firstBrace = normalized.indexOf('{');
  const lastBrace = normalized.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return normalized.slice(firstBrace, lastBrace + 1);
  }
  return normalized;
}

async function selectChartTypeEval(
  queryResults: QueryResults,
  sqlQuery: string,
  userInput: string,
): Promise<{ chartType: 'bar' | 'line' | 'pie'; reasoningText: string }> {
  const metadata = buildChartMetadata(queryResults);
  const { text } = await generateText({
    model,
    prompt: SELECT_CHART_TYPE_PROMPT(userInput, sqlQuery, metadata),
  });

  const parsed = JSON.parse(extractJsonObject(text)) as {
    chartType: 'bar' | 'line' | 'pie';
    reasoningText?: string;
    reasoning?: string;
  };

  const normalized = {
    chartType: parsed.chartType,
    reasoningText: parsed.reasoningText ?? parsed.reasoning ?? '',
  };

  return ChartTypeSelectionSchema.parse(normalized);
}

async function generateChartEval(input: {
  queryResults: QueryResults;
  sqlQuery: string;
  userInput: string;
}): Promise<ChartPipelineOutput['chart']> {
  const selection = await selectChartTypeEval(
    input.queryResults,
    input.sqlQuery,
    input.userInput,
  );

  const metadata = buildChartMetadata(input.queryResults);
  const { text } = await generateText({
    model,
    prompt: GENERATE_CHART_CONFIG_PROMPT(
      selection.chartType,
      metadata,
      input.sqlQuery,
    ),
  });

  const template = ChartConfigTemplateSchema.parse(
    JSON.parse(extractJsonObject(text)),
  );

  const data = evaluateChartData(
    selection.chartType,
    input.queryResults,
    template.config,
  );

  return ChartConfigSchema.parse({
    chartType: template.chartType,
    title: template.title,
    data,
    config: template.config,
  });
}

const goldens = await chartPipelineDataset.pull({ local: true });

await evalSuite('Chart Pipeline', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: chartPipelineDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: {
    overall: [],
  },
  cases: goldens.map((g) => {
    const scenarioId = String(g.metadata?.scenario ?? '');
    const scenario = SCENARIOS[scenarioId];
    if (!scenario) {
      throw new Error(`Missing chart pipeline scenario for ${g.id}`);
    }

    return {
      ...g,
      agent: async (input: string) => {
        let selection:
          | {
              chartType: 'bar' | 'line' | 'pie';
              reasoningText: string;
            }
          | undefined;

        try {
          selection = await selectChartTypeEval(
            scenario.queryResults,
            scenario.sqlQuery,
            input,
          );
        } catch (error) {
          return JSON.stringify({
            ok: false,
            stage: 'selectChartType',
            error: error instanceof Error ? error.message : String(error),
          } satisfies ChartPipelineFailure);
        }

        let chart;
        try {
          chart = await generateChartEval({
            queryResults: scenario.queryResults,
            sqlQuery: scenario.sqlQuery,
            userInput: input,
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            stage: 'generateChart',
            error: error instanceof Error ? error.message : String(error),
            selection,
          } satisfies ChartPipelineFailure);
        }

        try {
          const svg = renderChartSvg(chart.chartType, chart.data, chart.config);
          return JSON.stringify({
            ok: true,
            selection,
            chart,
            svg,
          } satisfies ChartPipelineOutput);
        } catch (error) {
          return JSON.stringify({
            ok: false,
            stage: 'renderChartSvg',
            error: error instanceof Error ? error.message : String(error),
            selection,
          } satisfies ChartPipelineFailure);
        }
      },
      customMetrics: [
        {
          name: 'pipeline_completed',
          fn: (out) => {
            const parsed = parseOutput(out);
            return isSuccess(parsed) ? 1 : 0;
          },
        },
        {
          name: 'selection_stage_success',
          fn: (out) => {
            const parsed = parseOutput(out);
            if (isSuccess(parsed)) return 1;
            if (!parsed) return 0;
            return parsed.stage === 'selectChartType' ? 0 : 1;
          },
        },
        {
          name: 'chart_generation_stage_success',
          fn: (out) => {
            const parsed = parseOutput(out);
            if (isSuccess(parsed)) return 1;
            if (!parsed) return 0;
            return parsed.stage === 'generateChart' ? 0 : 1;
          },
        },
        {
          name: 'render_stage_success',
          fn: (out) => {
            const parsed = parseOutput(out);
            if (isSuccess(parsed)) return 1;
            if (!parsed) return 0;
            return parsed.stage === 'renderChartSvg' ? 0 : 1;
          },
        },
        {
          name: 'json_parse_reliability',
          fn: (out) => {
            const parsed = parseOutput(out);
            if (!parsed) return 0;
            if (isSuccess(parsed)) return 1;
            return /parse|schema|json/i.test(parsed.error) ? 0 : 1;
          },
        },
        {
          name: 'selected_chart_type_match',
          fn: (out, groundTruth) => {
            const parsed = parseOutput(out);
            const spec = parseSpec(groundTruth);
            if (!parsed?.selection) return 0;
            return parsed.selection.chartType === spec.selectedChartType ? 1 : 0;
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
              Object.entries(spec.config).filter(([, value]) => typeof value === 'string' && value),
            ) as Record<string, string>;

            const keys = Object.keys(expected);
            if (keys.length === 0) return 1;

            const matched = keys.filter((key) => actual[key] === expected[key]).length;
            return matched / keys.length;
          },
        },
        {
          name: 'data_projection_match',
          fn: (out, groundTruth) => {
            const parsed = parseOutput(out);
            const spec = parseSpec(groundTruth);
            if (!isSuccess(parsed)) return 0;
            return normalizeRows(parsed.chart.data) === normalizeRows(spec.expectedData) ? 1 : 0;
          },
        },
        {
          name: 'svg_valid',
          fn: (out) => {
            const parsed = parseOutput(out);
            return isSuccess(parsed) &&
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
            if (required.length === 0) return 1;
            const lowerSvg = parsed.svg.toLowerCase();
            const matched = required.filter((item) =>
              lowerSvg.includes(item.toLowerCase()),
            ).length;
            return matched / required.length;
          },
        },
        {
          name: 'svg_has_visual_marks',
          fn: (out) => {
            const parsed = parseOutput(out);
            if (!isSuccess(parsed)) return 0;
            return countSvgMarks(parsed.svg) >= Math.max(2, parsed.chart.data.length) ? 1 : 0;
          },
        },
      ],
    };
  }),
});
