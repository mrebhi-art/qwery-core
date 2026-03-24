/**
 * Ask Agent – evalSuite script
 *
 * Tests the qwery-core Ask agent using the @qwery/tracing-sdk evalSuite runner.
 * Results are saved to qwery-eval (localhost:4097) and visible in the UI at
 * localhost:5090 → Datasets → ask-agent-evals
 *
 * How to run:
 *   cd qwery-core
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite
 *
 * What it does:
 *  1. Calls the Ask agent directly (same LLM + tools path as production)
 *  2. Scores each response with built-in metrics (string_similarity, contains_match)
 *  3. Scores custom metrics client-side (response length, markdown usage, etc.)
 *  4. Posts everything to the qwery-eval backend for persistence
 *  5. Prints a colour-coded pass/fail table to the terminal
 *
 * The Ask agent uses all registered tools (getSchema, runQuery, webFetch, …).
 * For eval cases that don't need a database, the tools are registered but
 * never called — the LLM simply answers the question conversationally.
 */

import { validateUIMessages, convertToModelMessages } from 'ai';
import { Provider } from '../../src/llm/provider';
import { Registry } from '../../src/tools/registry';
import { LLM } from '../../src/llm/llm';
import { evalSuite } from '@qwery/tracing-sdk/eval';

// ─── Agent helper ─────────────────────────────────────────────────────────────
// Mirrors runAskAgentTurn from ask.eval.ts — calls the LLM directly without
// repos so the eval is self-contained.

async function askAgent(userMessage: string, model: string): Promise<string> {
  const abortController = new AbortController();
  const providerModel = Provider.getModelFromString(model);
  const modelForRegistry = {
    providerId: providerModel.providerID,
    modelId: providerModel.id,
  };

  // Build a minimal ToolContext — repos deliberately omitted for eval
  const getContext = (options: { toolCallId?: string; abortSignal?: AbortSignal }) => ({
    conversationId: 'eval-session',
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

// Override with EVAL_MODEL env var:
//   EVAL_MODEL=ollama-cloud/minimax-m2.5          (default)
//   EVAL_MODEL=ollama-cloud/deepseek-v3.1:671b
//   EVAL_MODEL=ollama-cloud/gemini-3-flash-preview
//   EVAL_MODEL=ollama-cloud/kimi-k2.5
//   EVAL_MODEL=ollama-cloud/gpt-oss:120b
//   EVAL_MODEL=ollama-cloud/glm-5
//   EVAL_MODEL=ollama-cloud/mistral-large-3:675b
//   EVAL_MODEL=ollama-cloud/qwen3.5:397b
//
// Auth: set OLLAMA_API_KEY (and optionally OLLAMA_BASE_URL, defaults to https://ollama.com/v1)
const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

await evalSuite('Ask Agent', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'ask-agent-evals',
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,

  metrics: {
    overall: ['string_similarity', 'contains_match'],
  },

  cases: [
    // ── Conversational / general knowledge ─────────────────────────────────

    {
      id: 'greeting',
      input: 'Hello! What can you help me with?',
      goldenOutput: 'I can help you query and analyze data, answer questions, and more.',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'is_helpful_response',
          fn: (out) => out.trim().length > 30 ? 1 : 0,
        },
        {
          name: 'no_error_keywords',
          fn: (out) => /error|exception|failed|sorry, i (can't|cannot)/i.test(out) ? 0 : 1,
        },
      ],
    },

    {
      id: 'simple-math',
      input: 'What is 144 divided by 12?',
      goldenOutput: '12',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'contains_correct_answer',
          fn: (out) => /\b12\b/.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Markdown formatting behaviour ───────────────────────────────────────

    {
      id: 'markdown-list',
      input: 'List 3 tips for writing good SQL queries.',
      goldenOutput: 'Use indexes, avoid SELECT *, and filter early with WHERE.',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'uses_markdown_list',
          fn: (out) => /^[\s-*]|^\d+\./m.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_sql_keywords',
          fn: (out) => /SELECT|WHERE|INDEX|JOIN/i.test(out) ? 1 : 0,
        },
        {
          name: 'has_three_or_more_points',
          fn: (out) => {
            const bullets = out.match(/^[\s]*[-*]\s+|^\d+\.\s+/gm) ?? [];
            return bullets.length >= 3 ? 1 : 0;
          },
        },
      ],
    },

    // ── Suggestion syntax behaviour ──────────────────────────────────────────

    {
      id: 'suggestion-syntax',
      input: 'What kind of data analysis can you do for me?',
      goldenOutput: '{{suggestion:',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'uses_suggestion_syntax',
          fn: (out) => /\{\{suggestion:/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_data_analysis',
          fn: (out) => /analyz|query|chart|visuali|data/i.test(out) ? 1 : 0,
        },
      ],
    },

    // ── Tool-calling intent (agent should mention getSchema / runQuery) ──────

    {
      id: 'data-query-intent',
      input: 'Can you show me the schema of my database?',
      goldenOutput: 'I will use getSchema to look up your database schema.',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_schema',
          fn: (out) => /schema|table|column|structure/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_substantive',
          fn: (out) => out.trim().length > 50 ? 1 : 0,
        },
      ],
    },

    {
      id: 'sql-suggestion',
      input: 'How would I write a SQL query to get total sales by region?',
      goldenOutput: 'SELECT region, SUM(sales) FROM orders GROUP BY region',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'contains_sql_select',
          fn: (out) => /SELECT/i.test(out) ? 1 : 0,
        },
        {
          name: 'contains_group_by',
          fn: (out) => /GROUP\s+BY/i.test(out) ? 1 : 0,
        },
        {
          name: 'mentions_sum_or_aggregate',
          fn: (out) => /SUM|COUNT|AVG|aggregate/i.test(out) ? 1 : 0,
        },
      ],
    },
  ],
});
