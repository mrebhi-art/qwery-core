/**
 * Multi-turn Ask Agent – evalConversation suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:multi-turn
 */

import { evalConversation, type ConversationMessage } from '@qwery/tracing-sdk/eval';
import { scopedConversationId } from '../_shared/eval-project';
import { runAskAgentHarness } from '../_shared/ask-agent-eval-harness';
import { multiTurnAskDataset } from '../../datasets/multi-turn/multi-turn-ask.dataset';

const MODEL =
  process.env.EVAL_MODEL ?? process.env.DEFAULT_MODEL ?? 'ollama/minimax-m2:cloud';

const goldens = await multiTurnAskDataset.pull();

function mkAgent(caseId: string) {
  return (history: ConversationMessage[], userMessage: string) =>
    runAskAgentHarness({
      history,
      userMessage,
      model: MODEL,
      conversationId: scopedConversationId(`mt-ask-${caseId}`),
      messageId: `eval-msg-${Math.floor(history.length / 2) + 1}`,
    });
}

await evalConversation('Multi-turn Ask Agent', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: multiTurnAskDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: {
    perTurn: { overall: ['task_completion', 'tool_correctness', 'step_efficiency'] },
    conversation: ['context_retention', 'turn_consistency', 'length_efficiency'],
  },
  cases: goldens.map((g) => ({ ...g, agent: mkAgent(g.id) })),
});
