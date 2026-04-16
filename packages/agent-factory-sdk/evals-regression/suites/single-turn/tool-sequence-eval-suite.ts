/**
 * Tool Sequence – single-turn eval suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:tools
 */

import { validateUIMessages, convertToModelMessages } from 'ai';
import { Provider } from '../../../src/llm/provider';
import { Registry } from '../../../src/tools/registry';
import { LLM } from '../../../src/llm/llm';
import { evalSuite } from '@qwery/tracing-sdk/eval';
import { scopedConversationId } from '../_shared/eval-project';
import { runAskAgentHarness } from '../_shared/ask-agent-eval-harness';
import { toolSequenceDataset } from '../../datasets/single-turn/tool-sequence.dataset';

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

async function askAgent(userMessage: string): Promise<string> {
  const abortController = new AbortController();
  const providerModel = Provider.getModelFromString(MODEL);
  const modelForRegistry = { providerId: providerModel.providerID, modelId: providerModel.id };
  const getContext = (options: { toolCallId?: string; abortSignal?: AbortSignal }) => ({
    conversationId: scopedConversationId('tool-sequence'),
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

function askAgentWithSynthetic(userMessage: string, caseId: string): Promise<string> {
  return runAskAgentHarness({
    userMessage,
    model: MODEL,
    conversationId: scopedConversationId(`tool-sequence-${caseId}`),
    messageId: `eval-${caseId}`,
  });
}

const goldens = await toolSequenceDataset.pull({ local: true });

await evalSuite('Tool Sequence', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: toolSequenceDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: { overall: [] },
  cases: goldens.map((g) => ({
    ...g,
    agent:
      g.id === 'tool-needs-datasource'
        ? askAgent
        : (input: string) => askAgentWithSynthetic(input, g.id),
  })),
});
