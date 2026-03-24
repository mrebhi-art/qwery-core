/**
 * SQL Quality – evalSuite script
 *
 * Tests the Ask agent's ability to produce and describe correct SQL for a range
 * of query types. Inputs are framed as "How would I write..." so the agent
 * explains the SQL in its response (no live database required).
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:sql
 */

import { validateUIMessages, convertToModelMessages } from 'ai';
import { Provider } from '../../src/llm/provider';
import { Registry } from '../../src/tools/registry';
import { LLM } from '../../src/llm/llm';
import { evalSuite } from '@qwery/tracing-sdk/eval';

// ─── Agent helper ─────────────────────────────────────────────────────────────

async function askAgent(userMessage: string, model: string): Promise<string> {
  const abortController = new AbortController();
  const providerModel = Provider.getModelFromString(model);
  const modelForRegistry = {
    providerId: providerModel.providerID,
    modelId: providerModel.id,
  };

  const getContext = (options: { toolCallId?: string; abortSignal?: AbortSignal }) => ({
    conversationId: 'eval-sql-quality',
    agentId: 'ask',
    messageId: 'eval-msg',
    callId: options.toolCallId,
    abort: options.abortSignal ?? abortController.signal,
    extra: {},
    messages: [],
    ask: async () => { },
    metadata: async () => { },
  });

  const { tools } = await Registry.tools.forAgent('ask', modelForRegistry, getContext);

  const messages = [
    {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: userMessage }],
    },
  ];
  const validated = await validateUIMessages({ messages });
  const messagesForLlm = await convertToModelMessages(validated, { tools });

  const result = await LLM.stream({
    model,
    messages: messagesForLlm,
    tools,
    abortSignal: abortController.signal,
  });

  return result.text;
}

// ─── Eval configuration ───────────────────────────────────────────────────────

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

await evalSuite('SQL Quality', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'sql-quality-evals',
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,

  // string_similarity compares the agent explanation to the golden SQL snippet.
  // contains_match checks if the golden SQL keyword is present anywhere in the response.
  metrics: {
    overall: ['string_similarity', 'contains_match'],
  },

  cases: [
    // ── Count query ──────────────────────────────────────────────────────────
    {
      id: 'sql-count',
      input: 'How would I write a SQL query to count all the orders in a database?',
      goldenOutput: 'SELECT COUNT(*) FROM orders',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'contains_select',
          fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'contains_count',
          fn: (out) => /\bCOUNT\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_no_apology',
          fn: (out) => /i (cannot|can't|am unable)/i.test(out) ? 0 : 1,
        },
      ],
    },

    // ── Aggregation with GROUP BY ─────────────────────────────────────────────
    {
      id: 'sql-aggregation',
      input: 'How would I write a SQL query to get the total sales amount for each region?',
      goldenOutput: 'SELECT region, SUM(sales) FROM orders GROUP BY region',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'contains_select',
          fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_group_by',
          fn: (out) => /GROUP\s+BY/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_aggregate',
          fn: (out) => /\b(SUM|COUNT|AVG|MAX|MIN)\b/i.test(out) ? 1 : 0,
        },
      ],
    },

    // ── JOIN query ────────────────────────────────────────────────────────────
    {
      id: 'sql-join',
      input: 'How would I write a SQL query to join the customers and orders tables to get each customer\'s order total?',
      goldenOutput: 'SELECT customers.name, SUM(orders.total) FROM customers JOIN orders ON customers.id = orders.customer_id GROUP BY customers.name',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'contains_select',
          fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_join',
          fn: (out) => /\bJOIN\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_customers_and_orders',
          fn: (out) => /customer/i.test(out) && /order/i.test(out) ? 1 : 0,
        },
      ],
    },

    // ── WHERE filter ──────────────────────────────────────────────────────────
    {
      id: 'sql-filter',
      input: 'How would I write a SQL query to get all orders where the total is greater than 500?',
      goldenOutput: 'SELECT * FROM orders WHERE total > 500',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'contains_select',
          fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_where_clause',
          fn: (out) => /\bWHERE\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_500',
          fn: (out) => /500/.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Top-N with ORDER BY ────────────────────────────────────────────────────
    {
      id: 'sql-top-n',
      input: 'How would I write a SQL query to find the top 3 products ranked by total revenue?',
      goldenOutput: 'SELECT product, SUM(revenue) AS total_revenue FROM sales GROUP BY product ORDER BY total_revenue DESC LIMIT 3',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'contains_select',
          fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_limit_or_top',
          fn: (out) => /\bLIMIT\b|\bTOP\s+\d/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_order_by',
          fn: (out) => /ORDER\s+BY/i.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Date range filter ─────────────────────────────────────────────────────
    {
      id: 'sql-date',
      input: 'How would I write a SQL query to filter sales records from Q1 2024, between January and March?',
      goldenOutput: "SELECT * FROM sales WHERE date BETWEEN '2024-01-01' AND '2024-03-31'",

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'contains_select',
          fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_date_filter',
          fn: (out) => /\bWHERE\b|\bBETWEEN\b/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_date_range',
          fn: (out) => /2024|january|march|q1|quarter/i.test(out) ? 1 : 0,
        },
      ],
    },
  ],
});
