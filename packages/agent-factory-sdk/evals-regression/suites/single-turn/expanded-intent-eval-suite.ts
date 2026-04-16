/**
 * Expanded Intent Coverage – single-turn eval suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:intents
 */

import { validateUIMessages, convertToModelMessages } from 'ai';
import { Provider } from '../../../src/llm/provider';
import { Registry } from '../../../src/tools/registry';
import { LLM } from '../../../src/llm/llm';
import { evalSuite } from '@qwery/tracing-sdk/eval';
import { scopedConversationId } from '../_shared/eval-project';
import { expandedIntentDataset } from '../../datasets/single-turn/expanded-intent.dataset';

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

async function askAgent(userMessage: string): Promise<string> {
  const abortController = new AbortController();
  const providerModel = Provider.getModelFromString(MODEL);
  const modelForRegistry = { providerId: providerModel.providerID, modelId: providerModel.id };
  const getContext = (options: { toolCallId?: string; abortSignal?: AbortSignal }) => ({
    conversationId: scopedConversationId('expanded-intent'),
    agentId: 'ask',
    messageId: 'eval-msg',
    callId: options.toolCallId,
    abort: options.abortSignal ?? abortController.signal,
    extra: {},
    messages: [],
    ask: async () => {},
    metadata: async () => {},
  });
  const { tools } = await Registry.tools.forAgent('ask', modelForRegistry, getContext);
  const messages = [{ id: 'user-1', role: 'user' as const, parts: [{ type: 'text' as const, text: userMessage }] }];
  const validated = await validateUIMessages({ messages });
  const messagesForLlm = await convertToModelMessages(validated, { tools });
  const result = await LLM.stream({ model: MODEL, messages: messagesForLlm, tools, abortSignal: abortController.signal });
  return result.text;
}

const goldens = await expandedIntentDataset.pull();

await evalSuite('Expanded Intent Coverage', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: expandedIntentDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: { overall: ['string_similarity', 'contains_match'] },
  cases: goldens.map((g) => ({ ...g, agent: askAgent })),
});
