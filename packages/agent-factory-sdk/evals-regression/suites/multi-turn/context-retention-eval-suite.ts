/**
 * Context Retention – evalConversation suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:context-retention
 */

import {
  evalConversation,
  type ConversationMessage,
  type ConversationCustomMetric,
} from '@qwery/tracing-sdk/eval';
import { scopedConversationId } from '../_shared/eval-project';
import { runAskAgentHarness } from '../_shared/ask-agent-eval-harness';
import { contextRetentionDataset } from '../../datasets/multi-turn/context-retention.dataset';

const MODEL =
  process.env.EVAL_MODEL ?? process.env.DEFAULT_MODEL ?? 'ollama/minimax-m2:cloud';

const goldens = await contextRetentionDataset.pull();

function mkAgent(caseId: string) {
  return (history: ConversationMessage[], userMessage: string) =>
    runAskAgentHarness({
      history,
      userMessage,
      model: MODEL,
      conversationId: scopedConversationId(`context-ret-${caseId}`),
      messageId: `eval-msg-${Math.floor(history.length / 2) + 1}`,
    });
}

/** Checks that a seeded entity token appears in assistant turns ≥ 3. */
function seedRecalledMetric(seed: string): ConversationCustomMetric {
  const escaped = seed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'i');
  return {
    name: 'context_seed_recalled',
    fn: (transcript: ConversationMessage[]) => {
      const assistantTurns = transcript.filter((m) => m.role === 'assistant');
      if (assistantTurns.length < 3) return 0;
      const later = assistantTurns.slice(2).map((m) => m.content).join('\n');
      return re.test(later) ? 1 : 0;
    },
  };
}

const SEEDS: Record<string, string> = {
  'retain-table-name': 'sales_2025',
  'retain-region-filter': 'EMEA',
  'retain-metric-name': 'Gross Margin',
  'retain-time-window': 'Q2 2025',
  'retain-table-alias': 'orders_fact',
};

await evalConversation('Context Retention', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: contextRetentionDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: {
    perTurn: { overall: ['task_completion', 'tool_correctness', 'step_efficiency'] },
    conversation: ['context_retention', 'turn_consistency', 'length_efficiency'],
  },
  cases: goldens.map((g) => ({
    ...g,
    agent: mkAgent(g.id),
    customConversationMetrics: SEEDS[g.id] ? [seedRecalledMetric(SEEDS[g.id]!)] : [],
  })),
});
