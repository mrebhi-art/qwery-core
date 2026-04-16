/**
 * SQL Quality – single-turn eval suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:sql
 */

import { evalSuite } from '@qwery/tracing-sdk/eval';
import { runAskAgentHarness } from '../_shared/ask-agent-eval-harness';
import { scopedConversationId } from '../_shared/eval-project';
import { sqlQualityDataset } from '../../datasets/single-turn/sql-quality.dataset';

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';

const goldens = await sqlQualityDataset.pull();

await evalSuite('SQL Quality', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: sqlQualityDataset.name,
  agentVersion: process.env['AGENT_VERSION'] ?? MODEL,
  metrics: {
    overall: [
      'task_completion',
      'tool_correctness',
      'argument_correctness',
      'plan_adherence',
      'step_efficiency',
      'string_similarity',
      'contains_match',
    ],
  },
  cases: goldens.map((g) => ({
    ...g,
    agent: (input: string) =>
      runAskAgentHarness({
        userMessage: input,
        model: MODEL,
        conversationId: scopedConversationId('sql-quality'),
        messageId: 'eval-msg',
      }),
  })),
});
