/**
 * Chart Generation – single-turn eval suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:chart
 */

import { evalSuite } from '@qwery/tracing-sdk/eval';
import { runAskAgentHarness } from '../_shared/ask-agent-eval-harness';
import { scopedConversationId } from '../_shared/eval-project';
import { chartGenerationDataset } from '../../datasets/single-turn/chart-generation.dataset';

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

const goldens = await chartGenerationDataset.pull();

await evalSuite('Chart Generation', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: chartGenerationDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: {
    overall: [
      'task_completion',
      'tool_correctness',
      'plan_adherence',
      'step_efficiency',
      'contains_match',
    ],
  },
  cases: goldens.map((g) => ({
    ...g,
    agent: (input: string) =>
      runAskAgentHarness({
        userMessage: input,
        model: MODEL,
        conversationId: scopedConversationId('chart-generation'),
        messageId: 'eval-msg',
      }),
  })),
});
