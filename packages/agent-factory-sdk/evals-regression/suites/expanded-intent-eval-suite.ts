/**
 * Expanded Intent Coverage – evalSuite script
 *
 * Extends intent evaluation beyond the original 5 intents (greeting, goodbye,
 * other, read-data, system-info) to cover:
 *   - Common operational intents: help, feedback, create-datasource, list-datasources
 *   - Multi-language read-data: Spanish, German, Arabic
 *   - Multi-turn context persistence
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:intents
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
    conversationId: 'eval-expanded-intent',
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

await evalSuite('Expanded Intent Coverage', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'expanded-intent-evals',
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,

  metrics: {
    overall: ['string_similarity', 'contains_match'],
  },

  cases: [
    // ── help intent ───────────────────────────────────────────────────────────
    {
      id: 'intent-help',
      input: 'Can you help me? I am not sure what you can do.',
      goldenOutput: 'I can help you query data, generate charts, and more.',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_capabilities',
          fn: (out) => /query|chart|data|analyz|help|assist/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_welcoming',
          fn: (out) => /help|assist|sure|happy|of course|absolutely/i.test(out) ? 1 : 0,
        },
        {
          name: 'appropriate_length',
          fn: (out) => out.trim().length > 20 ? 1 : 0,
        },
      ],
    },

    // ── feedback intent ───────────────────────────────────────────────────────
    {
      id: 'intent-feedback',
      input: 'I have some feedback: the charts could be more colorful.',
      goldenOutput: 'thank you for your feedback',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'acknowledges_feedback',
          fn: (out) => /thank|appreciate|noted|feedback|hear|value/i.test(out) ? 1 : 0,
        },
        {
          name: 'no_error_in_response',
          fn: (out) => /\b(error|exception|crash|failed)\b/i.test(out) ? 0 : 1,
        },
      ],
    },

    // ── create-datasource intent ──────────────────────────────────────────────
    {
      id: 'intent-create-datasource',
      input: 'I want to add a new PostgreSQL database connection to Qwery',
      goldenOutput: 'datasource',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_connection',
          fn: (out) => /connect|datasource|database|postgresql|postgres|add/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_helpful_guidance',
          fn: (out) => out.trim().length > 30 ? 1 : 0,
        },
      ],
    },

    // ── list-datasources intent ───────────────────────────────────────────────
    {
      id: 'intent-list-datasources',
      input: 'What databases and datasources am I currently connected to?',
      goldenOutput: 'datasource',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'mentions_datasource',
          fn: (out) => /datasource|connect|database|list|attach/i.test(out) ? 1 : 0,
        },
        {
          name: 'appropriate_length',
          fn: (out) => out.trim().length > 15 ? 1 : 0,
        },
      ],
    },

    // ── Spanish: read-data ────────────────────────────────────────────────────
    {
      id: 'intent-es-read-data',
      input: '¿Cuántos usuarios hay en la base de datos?',
      goldenOutput: 'datos',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'is_data_response',
          fn: (out) => /query|sql|datos|usuario|data|database|connect|schema/i.test(out) ? 1 : 0,
        },
        {
          name: 'no_error_in_response',
          fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1,
        },
        {
          name: 'appropriate_length',
          fn: (out) => out.trim().length > 15 ? 1 : 0,
        },
      ],
    },

    // ── German: read-data ─────────────────────────────────────────────────────
    {
      id: 'intent-de-read-data',
      input: 'Wie viele Benutzer sind in der Datenbank gespeichert?',
      goldenOutput: 'daten',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'is_data_response',
          fn: (out) => /query|sql|daten|benutzer|data|database|connect|schema/i.test(out) ? 1 : 0,
        },
        {
          name: 'no_error_in_response',
          fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1,
        },
        {
          name: 'appropriate_length',
          fn: (out) => out.trim().length > 15 ? 1 : 0,
        },
      ],
    },

    // ── Arabic: read-data ─────────────────────────────────────────────────────
    {
      id: 'intent-ar-read-data',
      input: 'كم عدد المستخدمين في قاعدة البيانات؟',
      goldenOutput: 'database',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'is_data_response',
          fn: (out) => /query|sql|data|database|user|connect|schema/i.test(out) ? 1 : 0,
        },
        {
          name: 'no_error_in_response',
          fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1,
        },
        {
          name: 'appropriate_length',
          fn: (out) => out.trim().length > 15 ? 1 : 0,
        },
      ],
    },

    // ── Multi-turn: intent persistence ────────────────────────────────────────
    // After a data-focused message, a casual "thanks" should still be handled
    // gracefully — the agent should not lose context or error out.
    {
      id: 'intent-multi-turn-persistence',
      input: '[Previous question: "Show me total sales by product category"]\n\nThanks, that was really helpful!',
      goldenOutput: 'data',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'maintains_context',
          fn: (out) => /data|query|result|sales|categor|product|chart/i.test(out) ? 1 : 0,
        },
        {
          name: 'is_friendly',
          fn: (out) => /welcome|glad|happy|help|great|anytime/i.test(out) ? 1 : 0,
        },
        {
          name: 'no_error_in_response',
          fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1,
        },
      ],
    },

    // ── Goodbye with context ───────────────────────────────────────────────────
    {
      id: 'intent-goodbye',
      input: 'Thanks for your help, goodbye!',
      goldenOutput: 'goodbye',

      agent: (input) => askAgent(input, MODEL),

      customMetrics: [
        {
          name: 'is_polite_farewell',
          fn: (out) => /bye|goodbye|see you|take care|welcome|anytime|pleasure/i.test(out) ? 1 : 0,
        },
        {
          name: 'no_error_in_response',
          fn: (out) => /\b(error|exception|crash)\b/i.test(out) ? 0 : 1,
        },
      ],
    },
  ],
});
