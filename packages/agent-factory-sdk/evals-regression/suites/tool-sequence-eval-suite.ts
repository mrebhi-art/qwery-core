/**
 * Tool Sequence – evalSuite script
 *
 * Tests the Ask agent's awareness of when and in what order to call tools
 * (getSchema, runQuery, etc.). Since evals run without a live database, we
 * verify the agent expresses the correct intent and tool awareness in its
 * response text.
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:tools
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
    conversationId: 'eval-tool-sequence',
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

await evalSuite('Tool Sequence', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'tool-sequence-evals',
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,

  metrics: {
    overall: ['string_similarity'],
  },

  cases: [
    // ── Schema discovery — agent should mention schema/columns ─────────────────
    {
      id: 'tool-schema-first',
      input: 'What columns does the orders table have?',
      goldenOutput: 'schema',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_schema',
          fn: (out) => /schema|column|table|structure|field/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_substantive',
          fn: (out) => out.trim().length > 50 ? 1 : 0,
        },
        {
          name: 'no_hallucinated_column_list',
          // Agent should acknowledge it needs to look up the schema, not invent columns
          fn: (out) => /schema|look up|fetch|check|datasource|connect/i.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Data query intent — agent should express SQL/query intent ──────────────
    {
      id: 'tool-query-intent',
      input: 'Run a query to count all active users in the system',
      goldenOutput: 'query',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_query_or_sql',
          fn: (out) => /query|sql|SELECT|COUNT|run/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_active',
          fn: (out) => /active|status|filter|where/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_substantive',
          fn: (out) => out.trim().length > 50 ? 1 : 0,
        },
      ],
    },

    // ── Pure conversational — no tools needed, just explanation ───────────────
    {
      id: 'tool-conversational',
      input: 'What is the difference between an INNER JOIN and a LEFT OUTER JOIN in SQL?',
      goldenOutput: 'inner join returns only matching rows',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'explains_inner_join',
          fn: (out) => /inner|match(ing)?/i.test(out) ? 1 : 0,
        },
        {
          name: 'explains_outer_join',
          fn: (out) => /outer|left|null|all row/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_substantive',
          fn: (out) => out.trim().length > 100 ? 1 : 0,
        },
      ],
    },

    // ── Datasource awareness — agent should mention needing a datasource ───────
    {
      id: 'tool-needs-datasource',
      input: 'Can you query my database and tell me how many records are in the products table?',
      goldenOutput: 'datasource',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_datasource_or_connect',
          fn: (out) => /datasource|connect|database|schema|attach/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_products',
          fn: (out) => /product/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_substantive',
          fn: (out) => out.trim().length > 30 ? 1 : 0,
        },
      ],
    },

    // ── Multi-step: schema then query — agent should describe both steps ───────
    {
      id: 'tool-schema-then-query',
      input: 'First check the schema of the invoices table, then count how many invoices are overdue',
      goldenOutput: 'schema',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_schema_step',
          fn: (out) => /schema|column|table|structure/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_count_or_overdue',
          fn: (out) => /count|overdue|filter|where|status/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_substantive',
          fn: (out) => out.trim().length > 50 ? 1 : 0,
        },
      ],
    },
  ],
});
