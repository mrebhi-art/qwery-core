/**
 * Latency & Token Harness
 *
 * A specialised agent harness used by the latency-token eval suite.
 * Unlike the standard ask-agent harness this one:
 *  - Intercepts fetch to prohibit JSON markdown fences (Minimax quirk)
 *  - Injects 500 mock rows into runQuery to stress-test Mustache token savings
 *  - Returns a JSON payload containing { text, inputTokens, outputTokens, totalTokens, latencyMs }
 *    so the suite can surface token/latency metrics alongside text metrics.
 */

import { validateUIMessages, convertToModelMessages } from 'ai';
import { Provider } from '../../../src/llm/provider';
import { Registry } from '../../../src/tools/registry';
import { LLM } from '../../../src/llm/llm';
import { SystemPrompt } from '../../../src/llm/system';
import { scopedConversationId } from './eval-project';

// ─── Minimax JSON fence prohibition ─────────────────────────────────────────
// Intercept fetch to append the Minimax JSON markdown fence prohibition
// without touching any application prompts in qwery-core.

let patchedFetch = false;
export function patchFetchForMinimax(): void {
  if (patchedFetch) return;
  patchedFetch = true;
  const originalFetch = global.fetch;
  global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    if (
      init?.body &&
      typeof init.body === 'string' &&
      url.toString().includes('/chat/completions')
    ) {
      try {
        const bodyPayload = JSON.parse(init.body);
        if (bodyPayload.messages?.length > 0) {
          const lastMsg = bodyPayload.messages[bodyPayload.messages.length - 1];
          if (lastMsg && typeof lastMsg.content === 'string') {
            lastMsg.content +=
              '\n\n**CRITICAL INSTRUCTION**: Do NOT wrap your response in markdown code blocks (```json). Output RAW JSON only. The very first character you output must be { and the last must be }.';
            init.body = JSON.stringify(bodyPayload);
          }
        }
      } catch {
        // ignore parse errors — pass through unchanged
      }
    }
    return originalFetch(url, init);
  };
}

// ─── Synthetic schema ─────────────────────────────────────────────────────────

export const LATENCY_MOCK_SCHEMA = {
  tables: [
    {
      name: 'sales',
      columns: [
        { name: 'region', type: 'text' },
        { name: 'month', type: 'text' },
        { name: 'revenue', type: 'number' },
      ],
    },
  ],
};

// ─── Harness ─────────────────────────────────────────────────────────────────

export type LatencyTokenResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
};

export async function runLatencyTokenHarness(
  userMessage: string,
  model: string,
  conversationSuffix = 'latency-token',
): Promise<string> {
  patchFetchForMinimax();

  const abortController = new AbortController();
  const providerModel = Provider.getModelFromString(model);
  const modelForRegistry = {
    providerId: providerModel.providerID,
    modelId: providerModel.id,
  };

  const getContext = (options: { toolCallId?: string; abortSignal?: AbortSignal }) => ({
    conversationId: scopedConversationId(conversationSuffix),
    agentId: 'ask',
    messageId: 'eval-msg',
    callId: options.toolCallId,
    abort: options.abortSignal ?? abortController.signal,
    extra: { attachedDatasources: ['synthetic-ds'] },
    messages: [],
    ask: async () => {},
    metadata: async () => {},
  });

  const { tools } = await Registry.tools.forAgent('ask', modelForRegistry, getContext);

  // Override getSchema with synthetic schema
  if (tools.getSchema) {
    tools.getSchema = {
      ...tools.getSchema,
      execute: async () => ({ schema: LATENCY_MOCK_SCHEMA }),
    } as typeof tools.getSchema;
  }

  // Override runQuery with 500 mock rows to stress-test Mustache token savings
  if (tools.runQuery) {
    tools.runQuery = {
      ...tools.runQuery,
      execute: async (args: { query: string }) => {
        const massiveRows = Array.from({ length: 500 }, (_, i) => ({
          region: `Region ${i}`,
          revenue: Math.floor(Math.random() * 10_000),
          month: `Month ${i % 12}`,
        }));
        return {
          result: { columns: ['region', 'revenue', 'month'], rows: massiveRows },
          sqlQuery: args.query,
          executed: true,
        };
      },
    } as typeof tools.runQuery;
  }

  // Override generateChart to avoid flaky schema mismatches from provider-specific
  // chart-selection output shape (reasoning vs reasoningText) during latency evals.
  if (tools.generateChart) {
    tools.generateChart = {
      ...tools.generateChart,
      execute: async () => ({
        chartType: 'bar',
        data: [],
        config: {
          colors: ['#60a5fa'],
          xKey: 'region',
          yKey: 'revenue',
        },
      }),
    } as typeof tools.generateChart;
  }

  if (tools.selectChartType) {
    tools.selectChartType = {
      ...tools.selectChartType,
      execute: async () => ({
        chartType: 'bar',
        reasoningText: 'Latency eval harness uses deterministic chart selection',
      }),
    } as typeof tools.selectChartType;
  }

  // Remove chart tools entirely so the latency benchmark focuses on query/token
  // behavior and avoids provider-dependent chart schema output paths.
  const mutableTools = tools as Record<string, unknown>;
  delete mutableTools.selectChartType;
  delete mutableTools.generateChart;

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
    'You have access to a synthetic datasource named "synthetic-ds". Use it to answer questions about sales.',
  ].join('\n\n');

  const t0 = Date.now();
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  try {
    const result = await LLM.stream({
      model,
      messages: messagesForLlm,
      tools,
      systemPrompt,
      abortSignal: abortController.signal,
    });
    text = await result.text;
    const usageObj = await result.usage;
    usage = {
      inputTokens: usageObj?.inputTokens ?? 0,
      outputTokens: usageObj?.outputTokens ?? 0,
      totalTokens: usageObj?.totalTokens ?? 0,
    };
  } catch (err: unknown) {
    const anyErr = err as {
      text?: string;
      message?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };
    text = anyErr.text ?? anyErr.message ?? 'Error occurred during generation';
    if (anyErr.usage) {
      usage = {
        inputTokens: anyErr.usage.inputTokens ?? 0,
        outputTokens: anyErr.usage.outputTokens ?? 0,
        totalTokens: anyErr.usage.totalTokens ?? 0,
      };
    }
  }

  const latencyMs = Date.now() - t0;

  return JSON.stringify({ text, ...usage, latencyMs } satisfies LatencyTokenResult);
}
