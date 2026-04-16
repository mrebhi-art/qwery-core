import { EvalClient } from './eval-client';
import type {
  ConversationCaseResult,
  ConversationEvalCase,
  ConversationEvalSuiteOptions,
  ConversationEvalSuiteResult,
  ConversationInlineOutput,
  ConversationMessage,
  MetricScore,
} from './types';

function resolveTurnInput(turn: ConversationEvalCase['turns'][number]): string {
  const input = turn.input.trim();
  if (!input) {
    throw new Error('[evalConversation] Turn is missing input');
  }
  return input;
}

function resolveTurnGroundTruth(
  turn: ConversationEvalCase['turns'][number],
): string | null {
  return turn.groundTruth ?? null;
}

const NO_COLOR = typeof process !== 'undefined' && (process.env.NO_COLOR || !process.stdout?.isTTY);

function green(s: string) { return NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`; }
function red(s: string) { return NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`; }
function yellow(s: string) { return NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`; }
function bold(s: string) { return NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`; }
function dim(s: string) { return NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`; }

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function truncate(s: string, max = 120): string {
  const single = String(s ?? '').replace(/\n/g, ' ').trim();
  return single.length > max ? single.slice(0, max) + '…' : single;
}

function metricToScore(
  m: { metric?: string; name?: string; category?: string; score: number; passed: boolean; detail?: string },
  fallbackCategory: string,
): MetricScore {
  return {
    name: m.name ?? m.metric ?? '(unknown)',
    category: m.category ?? fallbackCategory,
    score: m.score,
    passed: m.passed,
    ...(m.detail !== undefined ? { detail: m.detail } : {}),
  };
}

function printHeader(suiteName: string, datasetName: string): void {
  console.log('');
  console.log(bold(`  ${suiteName}`));
  console.log(dim(`  dataset: ${datasetName}`));
  console.log('');
}

function printCaseResult(result: ConversationCaseResult): void {
  const icon = result.error ? red('✗') : result.passed ? green('✓') : red('✗');
  const score = result.overallScore;
  const scoreStr = score >= 0.8 ? green(score.toFixed(2)) : score >= 0.5 ? yellow(score.toFixed(2)) : red(score.toFixed(2));
  console.log(`  ${icon} ${bold(result.id)} ${dim('(')}${scoreStr}${dim(')')} · ${result.turns.length} turns`);

  if (result.error) {
    console.log(`    ${red('Error:')} ${result.error}`);
    return;
  }

  const firstTurn = result.turns[0];
  const lastTurn = result.turns[result.turns.length - 1];
  if (firstTurn) {
    console.log(`    ${dim('Turn 1:')} ${truncate(firstTurn.generatedOutput, 90)}`);
  }
  if (lastTurn && lastTurn !== firstTurn) {
    console.log(`    ${dim(`Turn ${lastTurn.turnIndex + 1}:`)} ${truncate(lastTurn.generatedOutput, 90)}`);
  }
}

function printSummary(result: ConversationEvalSuiteResult): void {
  const { total, passed, failed, avgScore, avgTurns } = result.summary;
  const icon = failed === 0 ? green('✓') : red('✗');
  console.log('');
  console.log(
    `  ${icon} ${bold('Summary')}  ${green(String(passed))}/${total} passed · avg score ${avgScore >= 0.8 ? green(avgScore.toFixed(3)) : yellow(avgScore.toFixed(3))} · avg turns ${avgTurns.toFixed(2)}`,
  );
  console.log(dim(`  Results → ${result.runId ? `run ${result.runId}` : 'n/a'}`));
  console.log('');
}

function parseConcurrency(
  explicit: number | undefined,
  envValue: string | undefined,
  fallback = 1,
): number {
  const fromExplicit = Number(explicit);
  if (Number.isFinite(fromExplicit) && fromExplicit > 0) {
    return Math.max(1, Math.floor(fromExplicit));
  }
  const fromEnv = Number(envValue);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.max(1, Math.floor(fromEnv));
  }
  return fallback;
}

async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}

type LocalCaseExecution = {
  output: ConversationInlineOutput;
  customConversationMetrics: MetricScore[];
  error?: string;
};

async function runCase(c: ConversationEvalCase, exampleId: string): Promise<LocalCaseExecution> {
  const history: ConversationMessage[] = [];
  const transcript: ConversationMessage[] = [];
  const turns: ConversationInlineOutput['turns'] = [];
  let error: string | undefined;

  for (const turn of c.turns) {
    const userInput = resolveTurnInput(turn);
    const turnGroundTruth = resolveTurnGroundTruth(turn);
    const startedAt = Date.now();
    try {
      const response = await c.agent(history, userInput);
      const durationMs = Date.now() - startedAt;

      const turnCustomMetrics: ConversationInlineOutput['turns'][number]['customMetrics'] = [];
      for (const cm of c.customTurnMetrics ?? []) {
        try {
          const raw = await cm.fn(response, turnGroundTruth ?? undefined, history);
          const score = clamp01(raw);
          turnCustomMetrics.push({ name: cm.name, score, passed: score >= 0.8 });
        } catch {
          turnCustomMetrics.push({ name: cm.name, score: 0, passed: false, detail: 'metric fn threw' });
        }
      }

      history.push({ role: 'user', content: userInput });
      history.push({ role: 'assistant', content: response });
      transcript.push({ role: 'user', content: userInput });
      transcript.push({ role: 'assistant', content: response });

      turns.push({
        generatedOutput: response,
        durationMs,
        customMetrics: turnCustomMetrics,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      turns.push({
        generatedOutput: '',
        durationMs: Date.now() - startedAt,
        customMetrics: [],
      });
      break;
    }
  }

  const customConversationMetrics: MetricScore[] = [];
  for (const cm of c.customConversationMetrics ?? []) {
    try {
      const raw = await cm.fn(transcript);
      const score = clamp01(raw);
      customConversationMetrics.push({
        name: cm.name,
        category: 'custom',
        score,
        passed: score >= 0.8,
      });
    } catch {
      customConversationMetrics.push({
        name: cm.name,
        category: 'custom',
        score: 0,
        passed: false,
        detail: 'metric fn threw',
      });
    }
  }

  return {
    output: { exampleId, turns },
    customConversationMetrics,
    ...(error ? { error } : {}),
  };
}

export async function evalConversation(
  suiteName: string,
  options: ConversationEvalSuiteOptions,
): Promise<ConversationEvalSuiteResult> {
  const {
    baseUrl = 'http://localhost:4097',
    datasetName,
    projectId = process.env['EVAL_PROJECT_ID'],
    datasourceId =
      process.env['EVAL_DATASOURCE_ID']?.trim() || undefined,
    caseConcurrency,
    agentVersion = process.env['AGENT_VERSION'] ?? '1.0.0',
    metrics = {
      perTurn: { overall: ['string_similarity'] },
      conversation: [],
    },
    cases,
  } = options;

  const client = new EvalClient(baseUrl);
  const maxCaseConcurrency = parseConcurrency(
    caseConcurrency,
    process.env['EVAL_CASE_CONCURRENCY'],
    1,
  );
  printHeader(suiteName, datasetName);

  console.log(dim('  Creating / resolving conversation dataset…'));
  const datasetId = await client.findOrCreateConversationDataset(
    datasetName,
    `Created by evalConversation: ${suiteName}`,
    projectId,
  );

  console.log(dim('  Uploading conversation examples…'));
  const exampleIds = await client.uploadConversationExamples(
    datasetId,
    cases.map((c) => ({
      turns: c.turns.map((t) => ({
        input: resolveTurnInput(t),
        groundTruth: resolveTurnGroundTruth(t),
        context: t.context,
        helpers: t.helpers,
        expectedTools: t.expectedTools,
        metadata: t.metadata,
      })),
      context: c.context,
      helpers: c.helpers,
      expectedTools: c.expectedTools,
      metadata: {
        caseId: c.id,
        ...(c.metadata ?? {}),
        ...(datasourceId ? { datasourceId } : {}),
      },
    })),
  );

  const runId = await client.startConversationRun({
    datasetId,
    agentVersion,
    perTurnMetrics: metrics.perTurn ?? { overall: ['string_similarity'] },
    conversationMetrics: metrics.conversation ?? [],
  });
  console.log(dim(`  Run ${runId} started`));
  console.log('');

  const localExecutions = await mapWithConcurrency(
    cases,
    maxCaseConcurrency,
    (c, i) => runCase(c, exampleIds[i]!),
  );

  const inlineOutputs = localExecutions.map((x) => x.output);
  const inlineResult = await client.executeConversationInline(runId, inlineOutputs);

  const results: ConversationCaseResult[] = cases.map((c, i) => {
    const local = localExecutions[i]!;
    const server = inlineResult.results[i];

    if (!server) {
      const result: ConversationCaseResult = {
        id: c.id,
        turns: [],
        conversationMetrics: local.customConversationMetrics,
        overallScore: 0,
        passed: false,
        error: local.error ?? 'Missing server result',
      };
      printCaseResult(result);
      return result;
    }

    const turns = server.turns.map((t) => {
      const turn = t as typeof t & {
        userMessage?: string;
        agentResponse?: string;
        goldenResponse?: string | null;
      };
      return {
        turnIndex: t.turnIndex,
        input: turn.userMessage ?? t.input,
        generatedOutput: turn.agentResponse ?? t.generatedOutput ?? '',
        groundTruth: turn.goldenResponse ?? t.groundTruth ?? null,
        actualTools: t.actualTools,
        turnMetrics: (t.turnMetrics ?? []).map((m) => metricToScore(m, 'turn')),
        turnScore: t.turnScore,
        durationMs: t.durationMs,
        ...(t.error ? { error: t.error } : {}),
      };
    });

    const conversationMetrics: MetricScore[] = [
      ...(server.conversationMetrics ?? []).map((m) => metricToScore(m, 'conversation')),
      ...local.customConversationMetrics,
    ];

    const result: ConversationCaseResult = {
      id: c.id,
      turns,
      conversationMetrics,
      overallScore: server.overallScore,
      passed: server.passed,
      ...(local.error || server.error ? { error: local.error ?? server.error } : {}),
    };
    printCaseResult(result);
    return result;
  });

  const avgTurns =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.turns.length, 0) / results.length
      : 0;

  const finalResult: ConversationEvalSuiteResult = {
    datasetId,
    runId,
    results,
    summary: {
      total: inlineResult.total,
      passed: inlineResult.passed,
      failed: inlineResult.failed,
      avgScore: inlineResult.avgScore,
      avgTurns,
    },
  };

  printSummary(finalResult);
  return finalResult;
}
