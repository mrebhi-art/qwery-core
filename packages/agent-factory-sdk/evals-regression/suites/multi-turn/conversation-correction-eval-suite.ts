/**
 * Conversation Correction – evalConversation suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:conv-correction
 */

import {
  evalConversation,
  type ConversationMessage,
  type ConversationCustomTurnMetric,
} from '@qwery/tracing-sdk/eval';
import { scopedConversationId } from '../_shared/eval-project';
import { runAskAgentHarness } from '../_shared/ask-agent-eval-harness';
import { conversationCorrectionDataset } from '../../datasets/multi-turn/conversation-correction.dataset';

const MODEL =
  process.env.EVAL_MODEL ?? process.env.DEFAULT_MODEL ?? 'ollama/minimax-m2:cloud';

const goldens = await conversationCorrectionDataset.pull();

function mkAgent(caseId: string) {
  return (history: ConversationMessage[], userMessage: string) =>
    runAskAgentHarness({
      history,
      userMessage,
      model: MODEL,
      conversationId: scopedConversationId(`conv-correction-${caseId}`),
      messageId: `eval-msg-${Math.floor(history.length / 2) + 1}`,
    });
}

/** Checks that the corrected value appears from turn 3 onwards. */
function correctedValueTurnMetric(correctedToken: string): ConversationCustomTurnMetric {
  const escaped = correctedToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'i');
  return {
    name: 'used_corrected_value',
    fn: (
      agentResponse: string,
      _goldenResponse: string | undefined,
      history: ConversationMessage[],
    ) => {
      if (history.length < 4) return 1; // grace period before correction applies
      return re.test(agentResponse) ? 1 : 0;
    },
  };
}

const CORRECTIONS: Record<string, string> = {
  'table-name-correction': 'crm_customers',
  'region-value-correction': 'LATAM',
  'kpi-correction': 'NRR',
  'date-window-correction': '2025',
  'aggregation-correction': 'total revenue',
};

await evalConversation('Conversation Correction', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: conversationCorrectionDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: {
    perTurn: { overall: ['task_completion', 'tool_correctness', 'step_efficiency'] },
    conversation: ['turn_consistency', 'length_efficiency'],
  },
  cases: goldens.map((g) => ({
    ...g,
    agent: mkAgent(g.id),
    customTurnMetrics: CORRECTIONS[g.id]
      ? [correctedValueTurnMetric(CORRECTIONS[g.id]!)]
      : [],
  })),
});
