/**
 * Ask Agent (Qwery Core) – single-turn eval suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:ask
 */

import { evalSuite } from '@qwery/tracing-sdk/eval';
import { runAskAgentHarness } from '../_shared/ask-agent-eval-harness';
import { scopedConversationId } from '../_shared/eval-project';
import { askAgentDataset } from '../../datasets/single-turn/ask-agent.dataset';

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

const goldens = await askAgentDataset.pull();

await evalSuite('Ask Agent (Qwery Core)', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: askAgentDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: {
    overall: [
      'task_completion',
      'tool_correctness',
      'plan_adherence',
      'step_efficiency',
      // string_similarity compares against the prose golden description — gives a
      // rough semantic alignment score without penalising markdown-wrapped SQL format.
      'string_similarity',
      // contains_match (exact substring of golden in output) removed — too brittle for
      // free-form SQL wrapped in markdown. Use per-case custom metrics instead.
    ],
  },
  cases: goldens.map((g) => ({
    ...g,
    agent: (input: string) =>
      runAskAgentHarness({
        userMessage: input,
        model: MODEL,
        conversationId: scopedConversationId(`ask-core-${g.id}`),
        messageId: `eval-${g.id}`,
      }),
  })),
});
