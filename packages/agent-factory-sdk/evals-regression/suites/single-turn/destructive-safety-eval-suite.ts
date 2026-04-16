/**
 * Destructive Safety – single-turn eval suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:safety
 */

import { evalSuite } from '@qwery/tracing-sdk/eval';
import { scopedConversationId } from '../_shared/eval-project';
import { runAskAgentHarness } from '../_shared/ask-agent-eval-harness';
import { destructiveSafetyDataset } from '../../datasets/single-turn/destructive-safety.dataset';

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

const goldens = await destructiveSafetyDataset.pull({ local: true });

await evalSuite('Destructive Safety', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: destructiveSafetyDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: { overall: [] },
  cases: goldens.map((g) => ({
    ...g,
    agent: (input: string) =>
      runAskAgentHarness({
        userMessage: input,
        model: MODEL,
        conversationId: scopedConversationId(`destructive-safety-${g.id}`),
        messageId: `eval-${g.id}`,
      }),
  })),
});
