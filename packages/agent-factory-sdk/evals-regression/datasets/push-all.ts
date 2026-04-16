/**
 * Registers all evaluation datasets to the qwery-eval backend in parallel.
 *
 * Run this once to seed a fresh environment, or after adding / editing goldens.
 *
 * Usage:
 *   pnpm --filter @qwery/agent-factory-sdk eval:dataset:push
 *   EVAL_BASE_URL=https://my-eval.internal pnpm eval:dataset:push
 */

// ── Single-turn ───────────────────────────────────────────────────────────────
import { askAgentDataset } from './single-turn/ask-agent.dataset';
import { sqlQualityDataset } from './single-turn/sql-quality.dataset';
import { chartGenerationDataset } from './single-turn/chart-generation.dataset';
import { toolSequenceDataset } from './single-turn/tool-sequence.dataset';
import { destructiveSafetyDataset } from './single-turn/destructive-safety.dataset';
import { expandedIntentDataset } from './single-turn/expanded-intent.dataset';
import { latencyTokenDataset } from './single-turn/latency-token.dataset';
import { mustacheTokenOptimizationDataset } from './single-turn/mustache-token-optimization.dataset';

// ── Multi-turn ────────────────────────────────────────────────────────────────
import { multiTurnAskDataset } from './multi-turn/multi-turn-ask.dataset';
import { contextRetentionDataset } from './multi-turn/context-retention.dataset';
import { conversationCorrectionDataset } from './multi-turn/conversation-correction.dataset';

// ─────────────────────────────────────────────────────────────────────────────

const ALL_DATASETS = [
  askAgentDataset,
  sqlQualityDataset,
  chartGenerationDataset,
  toolSequenceDataset,
  destructiveSafetyDataset,
  expandedIntentDataset,
  latencyTokenDataset,
  mustacheTokenOptimizationDataset,
  multiTurnAskDataset,
  contextRetentionDataset,
  conversationCorrectionDataset,
];

console.log(`\n  Pushing ${ALL_DATASETS.length} datasets to ${process.env.EVAL_BASE_URL ?? 'http://localhost:4097'}…\n`);

// push() calls are already made on import in each dataset file above (top-level await).
// This script intentionally imports all of them so they all push in a single run.
// The individual push() calls at the bottom of each dataset file handle the actual work.

console.log(`\n  ✓ All datasets pushed.\n`);
