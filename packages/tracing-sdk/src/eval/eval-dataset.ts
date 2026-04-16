import { EvalClient } from './eval-client';
import type {
  CustomMetric,
  ConversationTurnSpec,
  ConversationCustomTurnMetric,
  ConversationCustomMetric,
  EvalContext,
  EvalHelpers,
  ExpectedToolCall,
  FreeformMetadata,
  EvalExampleRow,
  ConversationEvalExampleRow,
} from './types';

const META_CONTEXT_KEY = '__v2_context';
const META_HELPERS_KEY = '__v2_helpers';
const META_EXPECTED_TOOLS_KEY = '__v2_expectedTools';

function parseJson<T>(value: unknown): T | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function resolveGroundTruth(input: {
  groundTruth: string;
}): string {
  const value = input.groundTruth.trim();
  if (!value) {
    throw new Error('[EvalDataset] Missing groundTruth while pushing dataset');
  }
  return value;
}

// ─── Golden types ─────────────────────────────────────────────────────────────

/**
 * A single-turn evaluation golden.
 *
 * A golden is a precursor to a test case — it holds the input and expected
 * output, but not the agent function. The agent is injected at eval time.
 *
 * `customMetrics` are kept in memory only (functions can't be serialised to
 * the backend). They are reattached to goldens retrieved via `pull()` by
 * matching `id`.
 */
export type Golden = {
  /** Stable identifier — used for deduplication in the backend. */
  id: string;
  /** The input fed to the agent. */
  input: string;

  /** The reference / expected output scored against generated output. */
  groundTruth: string;

  context?: EvalContext;
  helpers?: EvalHelpers;
  expectedTools?: ExpectedToolCall[];

  metadata?: FreeformMetadata;

  /** Optional custom scoring functions evaluated client-side. */
  customMetrics?: CustomMetric[];
};

/**
 * A multi-turn / conversation evaluation golden.
 *
 * Holds the conversation turns and expected responses, but not the agent.
 * Custom metrics are in-memory only, reattached via `id` on `pull()`.
 */
export type ConversationGolden = {
  /** Stable identifier — used for deduplication in the backend. */
  id: string;
  /** The ordered conversation turns. */
  turns: ConversationTurnSpec[];

  context?: EvalContext;
  helpers?: EvalHelpers;
  expectedTools?: ExpectedToolCall[];
  metadata?: FreeformMetadata;

  /** Optional per-turn scoring functions, evaluated client-side. */
  customTurnMetrics?: ConversationCustomTurnMetric[];
  /** Optional whole-conversation scoring functions, evaluated client-side. */
  customConversationMetrics?: ConversationCustomMetric[];
};

// ─── EvalDataset ─────────────────────────────────────────────────────────────

export type EvalDatasetOptions = {
  name: string;
  description?: string;
  goldens: Golden[];
};

export type PushOptions = {
  baseUrl?: string;
  projectId?: string;
};

export type PullOptions = {
  /** If `true`, skip the network call and return the in-memory goldens. Default: false. */
  local?: boolean;
  baseUrl?: string;
};

/**
 * A typed, class-based single-turn evaluation dataset.
 *
 * Inspired by deepeval's `EvaluationDataset` — you define goldens once,
 * `push()` them to the qwery-eval backend, and `pull()` them at eval time
 * to get the freshest server-side state merged with your local `customMetrics`.
 *
 * @example
 * ```ts
 * // datasets/single-turn/sql-quality.dataset.ts
 * import { EvalDataset } from '@qwery/tracing-sdk/eval';
 *
 * export const sqlQualityDataset = new EvalDataset({
 *   name: 'sql-quality-evals',
 *   goldens: [
 *     {
 *       id: 'sql-count',
 *       input: 'How do I count all orders?',
 *       groundTruth: 'SELECT COUNT(*) FROM orders',
 *       customMetrics: [
 *         { name: 'has_select', fn: (out) => /SELECT/i.test(out) ? 1 : 0 },
 *       ],
 *     },
 *   ],
 * });
 *
 * // Self-register when run directly:
 * await sqlQualityDataset.push();
 * ```
 *
 * @example
 * ```ts
 * // suites/single-turn/sql-quality-eval-suite.ts
 * import { evalSuite } from '@qwery/tracing-sdk/eval';
 * import { sqlQualityDataset } from '../../datasets/single-turn/sql-quality.dataset';
 *
 * const goldens = await sqlQualityDataset.pull();
 *
 * await evalSuite('SQL Quality', {
 *   datasetName: sqlQualityDataset.name,
 *   metrics: { overall: ['string_similarity'] },
 *   cases: goldens.map(g => ({ ...g, agent: myAgent })),
 * });
 * ```
 */
export class EvalDataset {
  readonly _multiTurn = false as const;
  readonly name: string;
  readonly description: string;
  readonly goldens: Golden[];

  constructor({ name, description = '', goldens }: EvalDatasetOptions) {
    this.name = name;
    this.description = description;
    this.goldens = goldens;
  }

  /**
   * Registers / syncs this dataset and its goldens to the qwery-eval backend.
   *
   * - Creates the dataset if it doesn't exist (idempotent by name).
   * - Uploads examples; the backend deduplicates by input so running push()
   *   multiple times won't create duplicates.
   */
  async push({ baseUrl, projectId }: PushOptions = {}): Promise<void> {
    const resolvedUrl = baseUrl ?? process.env['EVAL_BASE_URL'] ?? 'http://localhost:4097';
    const resolvedProject = projectId ?? process.env['EVAL_PROJECT_ID'];
    const client = new EvalClient(resolvedUrl);

    const datasetId = await client.findOrCreateDataset(
      this.name,
      this.description,
      resolvedProject,
    );

    await client.uploadExamples(
      datasetId,
      this.goldens.map((g) => ({
        input: g.input,
        groundTruth: resolveGroundTruth(g),
        context: g.context,
        helpers: g.helpers,
        expectedTools: g.expectedTools,
        metadata: {
          caseId: g.id,
          ...(g.metadata ?? {}),
        },
      })),
    );

    console.log(`  ✓ Pushed ${this.goldens.length} golden(s) → "${this.name}" (${datasetId})`);
  }

  /**
   * Pulls goldens from the qwery-eval backend and merges them with local
   * `customMetrics` (matched by `id`).
   *
   * - Any goldens added via the UI (unknown ids) are returned without customMetrics.
   * - Pass `{ local: true }` to skip the network call and use in-memory goldens.
   */
  async pull({ local = false, baseUrl }: PullOptions = {}): Promise<Golden[]> {
    if (local) return this.goldens;

    const resolvedUrl = baseUrl ?? process.env['EVAL_BASE_URL'] ?? 'http://localhost:4097';
    const client = new EvalClient(resolvedUrl);

    // Find dataset by name
    const datasets = await client.listDatasets();
    const found = datasets.find((d) => d.name === this.name);
    if (!found) {
      console.warn(`  ⚠  Dataset "${this.name}" not found on backend — using in-memory goldens. Run push() first.`);
      return this.goldens;
    }

    const { examples } = await client.getDataset(found.id);

    // Build a local lookup for custom metrics by caseId
    const localById = new Map(this.goldens.map((g) => [g.id, g]));

    return examples.map((ex: EvalExampleRow): Golden => {
      const caseId = ex.metadata?.['caseId'] ?? ex.id;
      const local = localById.get(caseId);
      const persistedGroundTruth =
        ex.groundTruth ||
        (ex as EvalExampleRow & { goldenOutput?: string | null }).goldenOutput ||
        '';
      return {
        id: caseId,
        input: ex.input,
        groundTruth: persistedGroundTruth,
        context:
          ex.context ??
          parseJson<EvalContext>((ex.metadata as Record<string, unknown>)?.[META_CONTEXT_KEY]),
        helpers:
          ex.helpers ??
          parseJson<EvalHelpers>((ex.metadata as Record<string, unknown>)?.[META_HELPERS_KEY]),
        expectedTools:
          ex.expectedTools ??
          parseJson<ExpectedToolCall[]>((ex.metadata as Record<string, unknown>)?.[META_EXPECTED_TOOLS_KEY]),
        metadata: ex.metadata,
        ...(local?.customMetrics ? { customMetrics: local.customMetrics } : {}),
      };
    });
  }
}

// ─── ConversationEvalDataset ──────────────────────────────────────────────────

export type ConversationEvalDatasetOptions = {
  name: string;
  description?: string;
  goldens: ConversationGolden[];
};

/**
 * A typed, class-based multi-turn / conversation evaluation dataset.
 *
 * Same API as `EvalDataset` but for conversation goldens backed by the
 * `/evaluation/conversations/datasets` endpoints.
 *
 * @example
 * ```ts
 * // datasets/multi-turn/context-retention.dataset.ts
 * import { ConversationEvalDataset } from '@qwery/tracing-sdk/eval';
 *
 * export const contextRetentionDataset = new ConversationEvalDataset({
 *   name: 'context-retention-evals',
 *   goldens: [
 *     {
 *       id: 'retain-table-name',
 *       turns: [
 *         { input: 'Use table sales_2025.', groundTruth: 'Understood.' },
 *         { input: 'Which table?', groundTruth: 'sales_2025' },
 *       ],
 *     },
 *   ],
 * });
 * ```
 */
export class ConversationEvalDataset {
  readonly _multiTurn = true as const;
  readonly name: string;
  readonly description: string;
  readonly goldens: ConversationGolden[];

  constructor({ name, description = '', goldens }: ConversationEvalDatasetOptions) {
    this.name = name;
    this.description = description;
    this.goldens = goldens;
  }

  /** Registers this conversation dataset and its goldens to the qwery-eval backend. */
  async push({ baseUrl, projectId }: PushOptions = {}): Promise<void> {
    const resolvedUrl = baseUrl ?? process.env['EVAL_BASE_URL'] ?? 'http://localhost:4097';
    const resolvedProject = projectId ?? process.env['EVAL_PROJECT_ID'];
    const client = new EvalClient(resolvedUrl);

    const datasetId = await client.findOrCreateConversationDataset(
      this.name,
      this.description,
      resolvedProject,
    );

    await client.uploadConversationExamples(
      datasetId,
      this.goldens.map((g) => ({
        turns: g.turns.map((t) => ({
          input: t.input,
          groundTruth: t.groundTruth ?? null,
          context: t.context,
          helpers: t.helpers,
          expectedTools: t.expectedTools,
          metadata: t.metadata,
        })),
        context: g.context,
        helpers: g.helpers,
        expectedTools: g.expectedTools,
        metadata: {
          caseId: g.id,
          ...(g.metadata ?? {}),
        },
      })),
    );

    console.log(`  ✓ Pushed ${this.goldens.length} golden(s) → "${this.name}" (${datasetId})`);
  }

  /**
   * Pulls conversation goldens from the backend and reattaches local metric
   * functions (matched by caseId stored in example metadata).
   */
  async pull({ local = false, baseUrl }: PullOptions = {}): Promise<ConversationGolden[]> {
    if (local) return this.goldens;

    const resolvedUrl = baseUrl ?? process.env['EVAL_BASE_URL'] ?? 'http://localhost:4097';
    const client = new EvalClient(resolvedUrl);

    const datasets = await client.listConversationDatasets();
    const found = datasets.find((d) => d.name === this.name);
    if (!found) {
      console.warn(`  ⚠  Conversation dataset "${this.name}" not found on backend — using in-memory goldens. Run push() first.`);
      return this.goldens;
    }

    const { examples } = await client.getConversationDataset(found.id);

    const localById = new Map(this.goldens.map((g) => [g.id, g]));

    return examples.map((ex: ConversationEvalExampleRow): ConversationGolden => {
      const caseId = ex.metadata?.['caseId'] ?? ex.id;
      const local = localById.get(caseId);
      return {
        id: caseId,
        turns: ex.turns.map((t) => {
          const turn = t as typeof t & {
            userMessage?: string;
            goldenResponse?: string | null;
          };
          return {
            input: turn.userMessage ?? turn.input,
            groundTruth: turn.goldenResponse ?? turn.groundTruth ?? null,
            context: turn.context,
            helpers: turn.helpers,
            expectedTools: turn.expectedTools,
            metadata: turn.metadata,
          };
        }),
        context: ex.context,
        helpers: ex.helpers,
        expectedTools: ex.expectedTools,
        metadata: ex.metadata,
        ...(local?.customTurnMetrics ? { customTurnMetrics: local.customTurnMetrics } : {}),
        ...(local?.customConversationMetrics ? { customConversationMetrics: local.customConversationMetrics } : {}),
      };
    });
  }
}
