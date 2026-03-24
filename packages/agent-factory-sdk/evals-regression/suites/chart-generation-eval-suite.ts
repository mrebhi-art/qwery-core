/**
 * Chart Generation – evalSuite script
 *
 * Tests the Ask agent's ability to explain, recommend, and describe different
 * chart types. Results are saved to the qwery-eval backend.
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:chart
 */

import { validateUIMessages, convertToModelMessages } from 'ai';
import { Provider } from '../../src/llm/provider';
import { Registry } from '../../src/tools/registry';
import { LLM } from '../../src/llm/llm';
import { SystemPrompt } from '../../src/llm/system';
import { evalSuite } from '@qwery/tracing-sdk/eval';

// Ensure internal tool calls (like in generateChart) use the correct provider
process.env.AGENT_PROVIDER = 'ollama-cloud';
// Use the development API key
process.env.OLLAMA_API_KEY = '5ffc8f70c62a4f9c888c679d2415395d.g0rnJUXK_H6lznCapx9zZ1K6';


// ─── Agent helper ─────────────────────────────────────────────────────────────

// ─── Agent helper ─────────────────────────────────────────────────────────────

const MOCK_SCHEMA = {
  tables: [
    {
      name: 'sales',
      columns: [
        { name: 'region', type: 'text' },
        { name: 'month', type: 'text' },
        { name: 'revenue', type: 'number' },
        { name: 'target', type: 'number' },
      ],
    },
    {
      name: 'market_share',
      columns: [
        { name: 'company', type: 'text' },
        { name: 'share_pct', type: 'number' },
        { name: 'category', type: 'text' },
      ],
    },
  ],
};

async function askAgent(userMessage: string, model: string): Promise<string> {
  const abortController = new AbortController();
  const providerModel = Provider.getModelFromString(model);
  const modelForRegistry = {
    providerId: providerModel.providerID,
    modelId: providerModel.id,
  };

  const getContext = (options: { toolCallId?: string; abortSignal?: AbortSignal }) => ({
    conversationId: 'eval-chart-generation',
    agentId: 'ask',
    messageId: 'eval-msg',
    callId: options.toolCallId,
    abort: options.abortSignal ?? abortController.signal,
    extra: {
      attachedDatasources: ['synthetic-ds'],
    },
    messages: [],
    ask: async () => { },
    metadata: async () => { },
  });

  const { tools } = await Registry.tools.forAgent('ask', modelForRegistry, getContext);

  // ── Synthetic metadata/data hacks ───────────────────────────────────────────
  // We override the real tools with synthetic ones so the agent "sees" data.
  if (tools.getSchema) {
    const original = tools.getSchema;
    tools.getSchema = {
      ...original,
      execute: async () => ({ schema: MOCK_SCHEMA }),
    } as any;
  }

  if (tools.runQuery) {
    const original = tools.runQuery;
    tools.runQuery = {
      ...original,
      execute: async (args: any) => {
        const query = (args.query as string).toLowerCase();
        if (query.includes('sales')) {
          return {
            result: {
              columns: ['region', 'revenue'],
              rows: [
                { region: 'North', revenue: 1000 },
                { region: 'South', revenue: 1500 },
                { region: 'East', revenue: 1200 },
                { region: 'West', revenue: 1800 },
              ],
            },
            sqlQuery: args.query,
            executed: true,
          };
        }
        if (query.includes('market_share')) {
          return {
            result: {
              columns: ['company', 'share_pct'],
              rows: [
                { company: 'Apple', share_pct: 45 },
                { company: 'Samsung', share_pct: 30 },
                { company: 'Google', share_pct: 15 },
                { company: 'Others', share_pct: 10 },
              ],
            },
            sqlQuery: args.query,
            executed: true,
          };
        }
        return { result: { columns: [], rows: [] }, sqlQuery: args.query, executed: true };
      },
    } as any;
  }

  const messages = [
    {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: userMessage }],
    },
  ];
  const validated = await validateUIMessages({ messages });
  const messagesForLlm = await convertToModelMessages(validated, { tools });

  const systemPrompt = [
    SystemPrompt.provider(providerModel),
    ...(await SystemPrompt.environment(providerModel)),
    'You have access to a synthetic datasource named "synthetic-ds". Use it to answer questions about sales and market share.',
  ].join('\n\n');

  const result = await LLM.stream({
    model,
    messages: messagesForLlm,
    tools,
    systemPrompt,
    abortSignal: abortController.signal,
  });

  return result.text;
}

// ─── Eval configuration ───────────────────────────────────────────────────────

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

const CHART_TYPE_RE = /\b(bar|pie|line|scatter|area|histogram|donut|heatmap|column)\b/i;

await evalSuite('Chart Generation', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'chart-generation-evals',
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,

  metrics: {
    chart: ['chart_svg_valid'],
    overall: ['contains_match'],
  },

  cases: [
    // ── Bar chart ─────────────────────────────────────────────────────────────
    {
      id: 'chart-bar',
      input: 'Show me sales by region as a bar chart from the sales table.',
      goldenOutput: '<svg', // We expect real SVG now

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_bar',
          fn: (out) => /\bbar\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'generated_svg',
          fn: (out) => out.includes('<svg') ? 1 : 0,
        },
        {
          name: 'mentions_chart_type',
          fn: (out) => CHART_TYPE_RE.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Pie chart ─────────────────────────────────────────────────────────────
    {
      id: 'chart-pie',
      input: 'Show me market share by company as a pie chart from the market_share table.',
      goldenOutput: '<svg',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_pie',
          fn: (out) => /\bpie\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'generated_svg',
          fn: (out) => out.includes('<svg') ? 1 : 0,
        },
        {
          name: 'mentions_chart_type',
          fn: (out) => CHART_TYPE_RE.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Sophisticated Case: Multi-step ────────────────────────────────────────
    {
      id: 'chart-sophisticated',
      input: 'Analyze the sales table. First, tell me which region has the highest revenue, then show me a chart comparing revenue vs target for all regions.',
      goldenOutput: 'West',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'identifies_highest_region',
          fn: (out) => /west/i.test(out) ? 1 : 0,
        },
        {
          name: 'generated_svg',
          fn: (out) => out.includes('<svg') ? 1 : 0,
        },
        {
          name: 'mentions_target',
          fn: (out) => /target/i.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Case: Chart recommendation ──────────────────────────────────────────
    {
      id: 'chart-recommend',
      input: 'What type of chart should I use to compare values across different categories?',
      goldenOutput: 'bar',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'recommends_bar_or_column',
          fn: (out) => /\b(bar|column)\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_comparison',
          fn: (out) => /compar|categor|group/i.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Case: Histogram description ─────────────────────────────────────────
    {
      id: 'chart-histogram',
      input: 'Describe what a histogram is and when I should use it',
      goldenOutput: 'distribution',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_distribution',
          fn: (out) => /distribut|frequency|bucket|bin|range/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_substantive',
          fn: (out) => out.trim().length > 50 ? 1 : 0,
        },
      ],
    },
  ],
});

