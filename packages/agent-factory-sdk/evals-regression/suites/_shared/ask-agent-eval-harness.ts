import { convertToModelMessages, validateUIMessages } from 'ai';
import { LLM } from '../../../src/llm/llm';
import { Provider } from '../../../src/llm/provider';
import { Registry } from '../../../src/tools/registry';
import { streamAgentResponse } from './stream-agent-response';
import { EVAL_DATASOURCE_ID, HAS_REAL_EVAL_DATASOURCE } from './eval-project';
import { buildDatasourceReminder } from '../../../src/agents/prompts/datasource-reminder';

const MOCK_SCHEMA = {
  tables: [
    {
      name: 'orders',
      columns: [
        { name: 'order_id', type: 'number' },
        { name: 'customer_id', type: 'number' },
        { name: 'order_date', type: 'date' },
        { name: 'region', type: 'text' },
        { name: 'product_category', type: 'text' },
        { name: 'sales', type: 'number' },
        { name: 'revenue', type: 'number' },
      ],
    },
    {
      name: 'customers',
      columns: [
        { name: 'customer_id', type: 'number' },
        { name: 'name', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'region', type: 'text' },
      ],
    },
    {
      name: 'sales',
      columns: [
        { name: 'date', type: 'date' },
        { name: 'month', type: 'text' },
        { name: 'region', type: 'text' },
        { name: 'product', type: 'text' },
        { name: 'category', type: 'text' },
        { name: 'revenue', type: 'number' },
        { name: 'target', type: 'number' },
      ],
    },
    {
      name: 'market_share',
      columns: [
        { name: 'company', type: 'text' },
        { name: 'category', type: 'text' },
        { name: 'share_pct', type: 'number' },
      ],
    },
  ],
};

function syntheticRowsForQuery(query: string): {
  columns: string[];
  rows: Record<string, unknown>[];
} {
  const q = query.toLowerCase();
  if (q.includes('group by region') || q.includes('sales by region')) {
    return {
      columns: ['region', 'total_sales'],
      rows: [
        { region: 'North', total_sales: 124000 },
        { region: 'South', total_sales: 118000 },
        { region: 'East', total_sales: 97000 },
        { region: 'West', total_sales: 136000 },
      ],
    };
  }
  if (q.includes('group by month') || q.includes('monthly') || q.includes('date_trunc')) {
    return {
      columns: ['month', 'total_revenue'],
      rows: [
        { month: '2024-01', total_revenue: 54000 },
        { month: '2024-02', total_revenue: 51000 },
        { month: '2024-03', total_revenue: 60000 },
        { month: '2024-04', total_revenue: 65000 },
      ],
    };
  }
  if (q.includes('customers') && (q.includes('join') || q.includes('customer_id'))) {
    return {
      columns: ['customer_id', 'total_spend'],
      rows: [
        { customer_id: 1, total_spend: 4200 },
        { customer_id: 2, total_spend: 3100 },
        { customer_id: 3, total_spend: 8750 },
        { customer_id: 4, total_spend: 1950 },
      ],
    };
  }
  // Product-level queries (top N products) — return 5 rows so the agent doesn't retry
  if (q.includes('product') && (q.includes('limit') || q.includes('top') || q.includes('revenue'))) {
    return {
      columns: ['product', 'total_revenue'],
      rows: [
        { product: 'Widget Pro', total_revenue: 84000 },
        { product: 'Gadget X', total_revenue: 71000 },
        { product: 'Doohickey', total_revenue: 63000 },
        { product: 'Thingamajig', total_revenue: 54000 },
        { product: 'Whatsit', total_revenue: 41000 },
      ],
    };
  }
  if (q.includes('market_share')) {
    return {
      columns: ['company', 'share_pct'],
      rows: [
        { company: 'Apple', share_pct: 45 },
        { company: 'Samsung', share_pct: 30 },
        { company: 'Google', share_pct: 15 },
        { company: 'Others', share_pct: 10 },
      ],
    };
  }
  return {
    columns: ['metric', 'value'],
    rows: [
      { metric: 'rows_returned', value: 12 },
      { metric: 'note', value: 'synthetic-data' },
    ],
  };
}

function pickSyntheticChartType(input: string): 'bar' | 'line' | 'pie' {
  const text = input.toLowerCase();
  if (/\b(pie|donut|share|distribution|proportion)\b/.test(text)) return 'pie';
  if (/\b(trend|time|monthly|weekly|daily|line)\b/.test(text)) return 'line';
  return 'bar';
}

type AskHarnessParams = {
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  model: string;
  conversationId: string;
  messageId: string;
};

let warnedSyntheticDatasource = false;

function maybeWarnDatasourceFallback(): void {
  if (HAS_REAL_EVAL_DATASOURCE) return;
  if (process.env['EVAL_SUPPRESS_DS_WARN'] === '1') return;
  if (warnedSyntheticDatasource) return;
  warnedSyntheticDatasource = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[eval] EVAL_DATASOURCE_ID is not set, using synthetic datasource "${EVAL_DATASOURCE_ID}".`,
  );
}

function usingSyntheticDatasource(): boolean {
  return !HAS_REAL_EVAL_DATASOURCE;
}

export async function runAskAgentHarness({
  history = [],
  userMessage,
  model,
  conversationId,
  messageId,
}: AskHarnessParams): Promise<string> {
  if (
    process.env['EVAL_REQUIRE_REAL_DATASOURCE'] === '1' &&
    usingSyntheticDatasource()
  ) {
    throw new Error(
      'EVAL_REQUIRE_REAL_DATASOURCE=1 but EVAL_DATASOURCE_ID is not set',
    );
  }

  maybeWarnDatasourceFallback();

  const abortController = new AbortController();
  const providerModel = Provider.getModelFromString(model);
  const modelForRegistry = {
    providerId: providerModel.providerID,
    modelId: providerModel.id,
  };

  const getContext = (options: { toolCallId?: string; abortSignal?: AbortSignal }) => ({
    conversationId,
    agentId: 'ask',
    messageId,
    callId: options.toolCallId,
    abort: options.abortSignal ?? abortController.signal,
    extra: {
      attachedDatasources: [EVAL_DATASOURCE_ID],
    },
    messages: [],
    ask: async () => {},
    metadata: async () => {},
  });

  const { tools } = await Registry.tools.forAgent('ask', modelForRegistry, getContext);

  const useSynthetic = usingSyntheticDatasource();

  if (useSynthetic && tools.getSchema) {
    const original = tools.getSchema;
    tools.getSchema = {
      ...original,
      execute: async () => ({
        schema: MOCK_SCHEMA,
        datasourceId: EVAL_DATASOURCE_ID,
      }),
    } as typeof tools.getSchema;
  }

  if (useSynthetic && tools.runQuery) {
    const original = tools.runQuery;
    tools.runQuery = {
      ...original,
      execute: async (args: { query: string }) => ({
        result: syntheticRowsForQuery(args.query),
        sqlQuery: args.query,
        executed: true,
        datasourceId: EVAL_DATASOURCE_ID,
      }),
    } as typeof tools.runQuery;
  }

  if (useSynthetic && tools.selectChartType) {
    const original = tools.selectChartType;
    tools.selectChartType = {
      ...original,
      execute: async (args: { sqlQuery?: string; userInput?: string }) => {
        const chartType = pickSyntheticChartType(
          `${args.userInput ?? ''} ${args.sqlQuery ?? ''}`,
        );
        return {
          chartType,
          reasoningText: `Synthetic eval fallback selected ${chartType} chart.`,
        };
      },
    } as typeof tools.selectChartType;
  }

  if (useSynthetic && tools.generateChart) {
    const original = tools.generateChart;
    tools.generateChart = {
      ...original,
      execute: async (args: {
        chartType?: 'bar' | 'line' | 'pie';
        sqlQuery?: string;
        userInput?: string;
      }) => {
        const result = syntheticRowsForQuery(
          args.sqlQuery ?? args.userInput ?? '',
        );
        const chartType =
          args.chartType ??
          pickSyntheticChartType(`${args.userInput ?? ''} ${args.sqlQuery ?? ''}`);
        const xKey = result.columns[0] ?? 'label';
        const yKey = result.columns[1] ?? 'value';
        if (chartType === 'pie') {
          return {
            chartType,
            data: result.rows,
            config: {
              colors: ['#2563eb', '#60a5fa', '#93c5fd', '#bfdbfe'],
              nameKey: xKey,
              valueKey: yKey,
            },
          };
        }
        return {
          chartType,
          data: result.rows,
          config: {
            colors: ['#2563eb', '#60a5fa', '#93c5fd', '#bfdbfe'],
            xKey,
            yKey,
          },
        };
      },
    } as typeof tools.generateChart;
  }

  const messages = [
    ...history.map((m, idx) => ({
      id: `hist-${idx + 1}`,
      role: m.role,
      parts: [{ type: 'text' as const, text: m.content }],
    })),
    {
      id: `user-${history.length + 1}`,
      role: 'user' as const,
      parts: [
        { type: 'text' as const, text: userMessage },
        {
          type: 'text' as const,
          text: buildDatasourceReminder([EVAL_DATASOURCE_ID]),
        },
      ],
    },
  ];

  const validated = await validateUIMessages({ messages });
  const messagesForLlm = await convertToModelMessages(validated, { tools });

  return streamAgentResponse(
    async () =>
      (await LLM.stream({
        model,
        messages: messagesForLlm,
        system:
          `Evaluation mode: produce concise final answers only.\n` +
          `Do not expose internal reasoning, plans, or chain-of-thought.\n` +
          `Datasource context: ${EVAL_DATASOURCE_ID} is attached for this conversation.`,
        tools,
        abortSignal: abortController.signal,
      })) as unknown as {
        fullStream?: AsyncIterable<unknown>;
        text?: Promise<string> | string;
      },
  );
}
