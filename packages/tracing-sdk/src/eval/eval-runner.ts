import { EvalClient } from './eval-client';
import type {
  EvalCase,
  EvalCaseResult,
  EvalSuiteOptions,
  EvalSuiteResult,
  InlineOutput,
  MetricScore,
} from './types';
import { extractSqlFromText } from './sql-extract';

// ─── Colour helpers (ANSI, graceful fallback) ─────────────────────────────────

const NO_COLOR = typeof process !== 'undefined' && (process.env.NO_COLOR || !process.stdout?.isTTY);

function green(s: string) { return NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`; }
function red(s: string) { return NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`; }
function yellow(s: string) { return NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`; }
function bold(s: string) { return NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`; }
function dim(s: string) { return NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`; }

// ─── Printing ─────────────────────────────────────────────────────────────────

function printHeader(suiteName: string, datasetName: string): void {
  console.log('');
  console.log(bold(`  ${suiteName}`));
  console.log(dim(`  dataset: ${datasetName}`));
  console.log('');
}

// Max chars shown for agent output / golden / extracted SQL in the terminal.
// Set EVAL_OUTPUT_CHARS=0 for unlimited output (all lines printed).
// Set EVAL_OUTPUT_CHARS=N to cap at N characters.
// Default: 300 — enough to show a full SQL query without clipping.
const _rawOutputChars = Number(process.env['EVAL_OUTPUT_CHARS'] ?? 300);
const MAX_OUTPUT_CHARS =
  Number.isFinite(_rawOutputChars) && _rawOutputChars >= 0 ? _rawOutputChars : 300;
const UNLIMITED = MAX_OUTPUT_CHARS === 0;
const SHOW_SQL_DEBUG = process.env['EVAL_DEBUG_SQL'] === '1';
const MINIMAL_CASE_OUTPUT = process.env['EVAL_MINIMAL_CASE_OUTPUT'] === '1';
const INCREMENTAL_RESULTS_ENABLED =
  process.env['EVAL_INCREMENTAL_RESULTS'] === '1' ||
  process.env['EVAL_STREAM_RESULTS'] === '1';

function printOutput(label: string, text: string): void {
  const t = text.trimEnd();
  if (UNLIMITED) {
    console.log(`    ${dim(label)}`);
    for (const line of t.split('\n')) {
      console.log(`      ${line}`);
    }
    return;
  }

  if (t.length <= MAX_OUTPUT_CHARS) {
    // Short enough — print on the same line, collapsing newlines to spaces
    console.log(`    ${dim(label)} ${t.replace(/\n/g, ' ')}`);
  } else {
    // Too long — print a clipped preview to avoid flooding terminal output.
    const clipped = `${t.slice(0, MAX_OUTPUT_CHARS)}... [truncated ${t.length - MAX_OUTPUT_CHARS} chars]`;
    console.log(`    ${dim(label)}`);
    for (const line of clipped.split('\n')) {
      console.log(`      ${line}`);
    }
  }
}

function looksLikeSqlText(value: string): boolean {
  return /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(value);
}

function printCaseResult(result: EvalCaseResult): void {
  const icon = result.error ? red('✗') : result.passed ? green('✓') : red('✗');
  const scoreLabel = result.error
    ? ''
    : ` ${dim('(')}${result.score >= 0.8 ? green(result.score.toFixed(2)) : result.score >= 0.5 ? yellow(result.score.toFixed(2)) : red(result.score.toFixed(2))}${dim(')')}`;
  console.log(`  ${icon} ${bold(result.id)}${scoreLabel}`);

  const expectedLabel = looksLikeSqlText(result.groundTruth ?? '')
    ? 'Golden SQL:'
    : 'Expected:';
  const structuredOutput = result.rawOutput
    ? parseStructuredAgentOutput(result.rawOutput)
    : null;

  if (result.error) {
    console.log(`    ${red('Error:')} ${result.error}`);

    if (result.generatedOutput) {
      printOutput('Output:', result.generatedOutput);
    }

    if (result.extractedOutput) {
      printOutput('Extracted SQL:', result.extractedOutput);
    }

    if (structuredOutput?.toolCalls && structuredOutput.toolCalls.length > 0) {
      printOutput('Tool Calls:', JSON.stringify(structuredOutput.toolCalls));
    }

    if (result.groundTruth) {
      printOutput(expectedLabel, result.groundTruth);
    }

    return;
  }

  // Agent output (always shown; EVAL_OUTPUT_CHARS=0 for unlimited)
  if (result.generatedOutput) {
    printOutput('Output:', result.generatedOutput);
  }

  if (structuredOutput?.toolCalls && structuredOutput.toolCalls.length > 0) {
    printOutput('Tool Calls:', JSON.stringify(structuredOutput.toolCalls));
  }

  if (
    SHOW_SQL_DEBUG &&
    result.rawOutput &&
    result.rawOutput.trim() &&
    result.rawOutput !== result.generatedOutput
  ) {
    printOutput('Raw Output:', result.rawOutput);
  }

  if (result.extractedOutput && result.extractedOutput !== result.generatedOutput) {
    printOutput('Generated SQL:', result.extractedOutput);
  }

  if (typeof result.sqlExecutionTimeMs === 'number') {
    console.log(`    ${dim('SQL exec ms:')} ${result.sqlExecutionTimeMs.toFixed(2)}`);
  }

  if (result.tokenUsage) {
    console.log(
      `    ${dim('Tokens:')} in=${result.tokenUsage.inputTokens} out=${result.tokenUsage.outputTokens} total=${result.tokenUsage.totalTokens}`,
    );
  }

  // Golden output / expected output for direct SQL comparison.
  if (result.groundTruth) {
    printOutput(expectedLabel, result.groundTruth);
  }

  if (MINIMAL_CASE_OUTPUT) {
    return;
  }

  // Metrics
  for (const m of result.metrics) {
    const isBoolean = m.score === 0 || m.score === 1;
    const scoreStr = isBoolean
      ? m.passed ? green('PASS') : red('FAIL')
      : m.score >= 0.8 ? green(m.score.toFixed(2)) : m.score >= 0.5 ? yellow(m.score.toFixed(2)) : red(m.score.toFixed(2));
    const customTag = m.category === 'custom' ? dim(' [custom]') : '';
    console.log(`    ${dim((m.name ?? '(unknown)').padEnd(32))} ${scoreStr}${customTag}`);
  }
}

type StructuredAgentOutput = {
  answer?: string;
  generatedSql?: string;
  sql?: string;
  query?: string;
  toolCalls?: Array<Record<string, unknown>>;
  sqlExecutionTimeMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costInCredits?: number;
    model?: string;
  };
};

function normalizeTokenUsage(
  usage: StructuredAgentOutput['usage'] | undefined,
): EvalCaseResult['tokenUsage'] | undefined {
  if (!usage) return undefined;

  const inputTokens =
    typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)
      ? usage.inputTokens
      : 0;
  const outputTokens =
    typeof usage.outputTokens === 'number' && Number.isFinite(usage.outputTokens)
      ? usage.outputTokens
      : 0;
  const totalTokens =
    typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
      ? usage.totalTokens
      : inputTokens + outputTokens;

  const hasAnyTokens = inputTokens > 0 || outputTokens > 0 || totalTokens > 0;
  if (!hasAnyTokens) return undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(typeof usage.costInCredits === 'number' && Number.isFinite(usage.costInCredits)
      ? { costInCredits: usage.costInCredits }
      : {}),
  };
}

function parseStructuredAgentOutput(output: string): StructuredAgentOutput | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;

    const answer =
      typeof parsed['answer'] === 'string'
        ? parsed['answer']
        : typeof parsed['output'] === 'string'
          ? parsed['output']
          : typeof parsed['text'] === 'string'
            ? parsed['text']
            : undefined;

    const generatedSql =
      typeof parsed['generatedSql'] === 'string'
        ? parsed['generatedSql']
        : typeof parsed['sql'] === 'string'
          ? parsed['sql']
          : typeof parsed['query'] === 'string'
            ? parsed['query']
            : undefined;

    const sqlExecutionTimeMs =
      typeof parsed['sqlExecutionTimeMs'] === 'number' &&
      Number.isFinite(parsed['sqlExecutionTimeMs'])
        ? parsed['sqlExecutionTimeMs']
        : undefined;

    const usageRaw =
      parsed['usage'] && typeof parsed['usage'] === 'object'
        ? (parsed['usage'] as Record<string, unknown>)
        : null;

    const toolCallsRaw = Array.isArray(parsed['toolCalls'])
      ? parsed['toolCalls']
      : undefined;
    const toolCalls = toolCallsRaw
      ? toolCallsRaw.filter(
          (tool): tool is Record<string, unknown> =>
            Boolean(tool) && typeof tool === 'object',
        )
      : undefined;

    const usage = usageRaw
      ? {
          ...(typeof usageRaw['inputTokens'] === 'number'
            ? { inputTokens: usageRaw['inputTokens'] }
            : {}),
          ...(typeof usageRaw['outputTokens'] === 'number'
            ? { outputTokens: usageRaw['outputTokens'] }
            : {}),
          ...(typeof usageRaw['totalTokens'] === 'number'
            ? { totalTokens: usageRaw['totalTokens'] }
            : {}),
          ...(typeof usageRaw['costInCredits'] === 'number'
            ? { costInCredits: usageRaw['costInCredits'] }
            : {}),
          ...(typeof usageRaw['model'] === 'string'
            ? { model: usageRaw['model'] }
            : {}),
        }
      : undefined;

    if (
      !answer &&
      !generatedSql &&
      !usage &&
      !toolCalls &&
      typeof sqlExecutionTimeMs !== 'number'
    ) {
      return null;
    }
    return {
      answer,
      generatedSql,
      sql: generatedSql,
      query: generatedSql,
      ...(toolCalls ? { toolCalls } : {}),
      ...(typeof sqlExecutionTimeMs === 'number' ? { sqlExecutionTimeMs } : {}),
      ...(usage ? { usage } : {}),
    };
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLabeledBlock(errorText: string, label: string): string | undefined {
  const escaped = escapeRegExp(label);
  const regex = new RegExp(
    `${escaped}\\n([\\s\\S]*?)(?=\\n(?:returned:|tool_calls:|extracted_sql:|stderr:)|$)`,
  );
  const match = errorText.match(regex);
  if (!match?.[1]) return undefined;
  const value = match[1].trim();
  return value.length > 0 ? value : undefined;
}


function printSummary(result: EvalSuiteResult): void {
  const { total, passed, failed, avgScore, tokenUsage, sqlExecution } = result.summary;
  const icon = failed === 0 ? green('✓') : red('✗');
  console.log('');
  console.log(
    `  ${icon} ${bold('Summary')}  ${green(String(passed))}/${total} passed · avg score ${avgScore >= 0.8 ? green(avgScore.toFixed(3)) : yellow(avgScore.toFixed(3))}`,
  );
  if (tokenUsage) {
    const tokenCost =
      typeof tokenUsage.costInCredits === 'number'
        ? ` · cost=${tokenUsage.costInCredits.toFixed(6)}`
        : '';
    console.log(
      dim(
        `  Tokens → in=${tokenUsage.inputTokens}, out=${tokenUsage.outputTokens}, total=${tokenUsage.totalTokens}${tokenCost}`,
      ),
    );
  }
  if (sqlExecution) {
    console.log(
      dim(
        `  SQL timing → total=${sqlExecution.totalMs.toFixed(2)}ms, avg=${sqlExecution.averageMs.toFixed(2)}ms, cases=${sqlExecution.casesWithSqlTiming}`,
      ),
    );
  }
  console.log(dim(`  Results → ${result.runId ? `run ${result.runId}` : 'n/a'}`));
  console.log('');
}

function isSqlLikeCase(datasetName: string, input: string, groundTruth: string): boolean {
  return datasetName.startsWith('sql-') ||
    datasetName.includes('bird') ||
    /\b(sql|query)\b/i.test(input) ||
    /^\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(groundTruth);
}

function parseConcurrency(
  explicit: number | undefined,
  envValue: string | undefined,
  fallback = 2,
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

type AgentExecutionResult =
  | { ok: true; output: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

async function executeAgentCase(c: EvalCase): Promise<AgentExecutionResult> {
  const t0 = Date.now();
  try {
    const output = await c.agent(c.input);
    return { ok: true, output, durationMs: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
    };
  }
}

async function buildInlineOutputForCase(
  c: EvalCase,
  exampleId: string,
  groundTruth: string,
  datasetName: string,
  agentResult: AgentExecutionResult,
): Promise<InlineOutput> {
  if (!agentResult.ok) {
    return { exampleId, generatedOutput: '', customMetrics: [] };
  }

  const customScores: InlineOutput['customMetrics'] = [];
  for (const cm of c.customMetrics ?? []) {
    try {
      const raw = await cm.fn(agentResult.output, groundTruth);
      const scoreValue = typeof raw === 'number' ? raw : (raw?.score ?? 0);
      const score = Math.max(0, Math.min(1, scoreValue));
      const detail = typeof raw === 'number' ? undefined : raw?.detail;
      customScores.push({
        name: cm.name,
        score,
        passed: score >= 0.8,
        ...(detail ? { detail } : {}),
      });
    } catch {
      customScores.push({
        name: cm.name,
        score: 0,
        passed: false,
        detail: 'metric fn threw',
      });
    }
  }

  const isSqlCase = isSqlLikeCase(datasetName, c.input, groundTruth);
  const structuredOutput = parseStructuredAgentOutput(agentResult.output);
  const answerForDisplay = structuredOutput?.answer ?? agentResult.output;
  const sqlSource = structuredOutput?.generatedSql ?? agentResult.output;
  const finalOutputForBackend = isSqlCase
    ? extractSqlFromText(sqlSource)
    : answerForDisplay;

  return {
    exampleId,
    generatedOutput: finalOutputForBackend,
    customMetrics: customScores,
  };
}

function buildCaseResult(
  c: EvalCase,
  datasetName: string,
  groundTruth: string,
  agentResult: AgentExecutionResult,
  serverResult:
    | {
        generatedOutput: string;
        groundTruth: string;
        actualTools?: EvalCaseResult['actualTools'];
        metrics?: Array<{
          metric?: string;
          name?: string;
          category: string;
          score: number;
          passed: boolean;
          detail?: string;
        }>;
        score?: number;
        passed?: boolean;
      }
    | undefined,
): EvalCaseResult {
  if (!agentResult.ok) {
    const returnedFromError = extractLabeledBlock(agentResult.error, 'returned:');
    const extractedSqlFromError = extractLabeledBlock(
      agentResult.error,
      'extracted_sql:',
    );
    const fallbackExtractedSql = extractSqlFromText(agentResult.error);
    const extractedOutput =
      extractedSqlFromError && extractedSqlFromError.length > 0
        ? extractedSqlFromError
        : fallbackExtractedSql && fallbackExtractedSql.length > 0
          ? fallbackExtractedSql
          : undefined;

    return {
      id: c.id,
      input: c.input,
      generatedOutput: returnedFromError ?? '',
      groundTruth,
      ...(extractedOutput ? { extractedOutput } : {}),
      metrics: [],
      score: 0,
      passed: false,
      durationMs: agentResult.durationMs,
      error: agentResult.error,
    };
  }

  const metrics: MetricScore[] = (serverResult?.metrics ?? []).map((m) => ({
    name:
      (m as { metric?: string; name?: string }).name ??
      (m as { metric?: string }).metric ??
      '(unknown)',
    category: m.category,
    score: m.score,
    passed: m.passed,
    ...(m.detail !== undefined ? { detail: m.detail } : {}),
  }));

  const compositeMetric = metrics.find(
    (metric) => metric.name === 'bird_final_composite_score',
  );
  const score = compositeMetric?.score ?? serverResult?.score ?? 0;
  const passed = compositeMetric
    ? compositeMetric.score >= 0.8
    : (serverResult?.passed ?? false);
  const serverGeneratedOutput = serverResult?.generatedOutput ?? '';
  const serverGroundTruth = serverResult?.groundTruth ?? groundTruth;

  const isSqlCase = isSqlLikeCase(datasetName, c.input, groundTruth);
  const structuredOutput = parseStructuredAgentOutput(agentResult.output);
  const answerForDisplay = structuredOutput?.answer ?? agentResult.output;
  const sqlSource = structuredOutput?.generatedSql ?? agentResult.output;
  const extractedSql = isSqlCase ? extractSqlFromText(sqlSource) : undefined;
  const generatedOutput = answerForDisplay;
  const tokenUsage = normalizeTokenUsage(structuredOutput?.usage);

  return {
    id: c.id,
    input: c.input,
    generatedOutput,
    rawOutput: agentResult.output,
    extractedOutput:
      isSqlCase && extractedSql && extractedSql !== generatedOutput
        ? extractedSql
        : isSqlCase &&
            serverGeneratedOutput &&
            serverGeneratedOutput !== generatedOutput
          ? serverGeneratedOutput
          : undefined,
    groundTruth: serverGroundTruth,
    ...(serverResult?.actualTools ? { actualTools: serverResult.actualTools } : {}),
    metrics,
    score,
    passed,
    durationMs: agentResult.durationMs,
    ...(tokenUsage ? { tokenUsage } : {}),
    ...(typeof structuredOutput?.sqlExecutionTimeMs === 'number' &&
    Number.isFinite(structuredOutput.sqlExecutionTimeMs)
      ? { sqlExecutionTimeMs: structuredOutput.sqlExecutionTimeMs }
      : {}),
  };
}

function buildFinalResult(
  datasetId: string,
  runId: string,
  caseResults: EvalCaseResult[],
): EvalSuiteResult {
  const tokenUsageTotals = caseResults.reduce(
    (acc, current) => {
      const usage = current.tokenUsage;
      if (!usage) return acc;
      return {
        inputTokens: acc.inputTokens + usage.inputTokens,
        outputTokens: acc.outputTokens + usage.outputTokens,
        totalTokens: acc.totalTokens + usage.totalTokens,
        costInCredits:
          acc.costInCredits +
          (typeof usage.costInCredits === 'number' ? usage.costInCredits : 0),
      };
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, costInCredits: 0 },
  );

  const hasTokenUsage =
    tokenUsageTotals.inputTokens > 0 ||
    tokenUsageTotals.outputTokens > 0 ||
    tokenUsageTotals.totalTokens > 0;

  const sqlExecutionTimes = caseResults
    .map((result) => result.sqlExecutionTimeMs)
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );

  const sqlExecutionSummary =
    sqlExecutionTimes.length > 0
      ? {
          totalMs: sqlExecutionTimes.reduce((sum, value) => sum + value, 0),
          averageMs:
            sqlExecutionTimes.reduce((sum, value) => sum + value, 0) /
            sqlExecutionTimes.length,
          casesWithSqlTiming: sqlExecutionTimes.length,
        }
      : undefined;

  return {
    datasetId,
    runId,
    results: caseResults,
    summary: {
      total: caseResults.length,
      passed: caseResults.filter((result) => result.passed).length,
      failed: caseResults.filter((result) => !result.passed).length,
      avgScore:
        caseResults.length > 0
          ? caseResults.reduce((sum, result) => sum + result.score, 0) /
            caseResults.length
          : 0,
      ...(hasTokenUsage
        ? {
            tokenUsage: {
              inputTokens: tokenUsageTotals.inputTokens,
              outputTokens: tokenUsageTotals.outputTokens,
              totalTokens: tokenUsageTotals.totalTokens,
              ...(tokenUsageTotals.costInCredits > 0
                ? { costInCredits: tokenUsageTotals.costInCredits }
                : {}),
            },
          }
        : {}),
      ...(sqlExecutionSummary ? { sqlExecution: sqlExecutionSummary } : {}),
    },
  };
}

// ─── evalSuite ────────────────────────────────────────────────────────────────

/**
 * Run a suite of evaluation cases against your agent, save results to the
 * qwery-eval backend, and print a summary table.
 *
 * @example
 * ```ts
 * import { evalSuite } from '@qwery/tracing-sdk/eval';
 *
 * await evalSuite('My Agent', {
 *   datasetName: 'my-agent-v1',
 *   metrics: { overall: ['string_similarity'] },
 *   cases: [
 *     {
 *       id: 'q1',
 *       input: 'What is 2+2?',
 *       groundTruth: '4',
 *       agent: async (input) => myAgent.run(input),
 *       customMetrics: [
 *         { name: 'mentions_four', fn: (out) => /\b4\b|four/i.test(out) ? 1 : 0 },
 *       ],
 *     },
 *   ],
 * });
 * ```
 */
export async function evalSuite(
  suiteName: string,
  options: EvalSuiteOptions,
): Promise<EvalSuiteResult> {
  const {
    baseUrl = 'http://localhost:4097',
    datasetName,
    projectId = process.env['EVAL_PROJECT_ID'],
    datasourceId =
      process.env['EVAL_DATASOURCE_ID']?.trim() || undefined,
    caseConcurrency,
    agentVersion = process.env['AGENT_VERSION'] ?? '1.0.0',
    metrics = { overall: ['string_similarity'] },
    cases,
  } = options;

  const maxCaseConcurrency = parseConcurrency(
    caseConcurrency,
    process.env['EVAL_CASE_CONCURRENCY'],
    1,
  );

  const client = new EvalClient(baseUrl);

  printHeader(suiteName, datasetName);

  // 1 — Find or create the dataset
  console.log(dim('  Creating / resolving dataset…'));
  const datasetId = await client.findOrCreateDataset(
    datasetName,
    `Created by evalSuite: ${suiteName}`,
    projectId,
  );

  // 2 — Upload examples (one call; server deduplicates by dataset + input hash if needed)
  console.log(dim('  Uploading examples…'));
  const exampleIds = await client.uploadExamples(
    datasetId,
    cases.map((c) => ({
      input: c.input,
      groundTruth: resolveGroundTruth(c),
      metadata: {
        caseId: c.id,
        ...(c.metadata ?? {}),
        ...(datasourceId ? { datasourceId } : {}),
      },
    })),
  );

  // 3 — Start an evaluation run
  const runId = await client.startRun({ datasetId, agentVersion, metrics });
  console.log(dim(`  Run ${runId} started`));
  console.log('');

  const incrementalMode = INCREMENTAL_RESULTS_ENABLED && maxCaseConcurrency === 1;
  if (INCREMENTAL_RESULTS_ENABLED && maxCaseConcurrency > 1) {
    console.log(
      dim(
        `  Incremental results require caseConcurrency=1 (current=${maxCaseConcurrency}); using batch result printing.`,
      ),
    );
    console.log('');
  }

  if (incrementalMode) {
    const caseResults: EvalCaseResult[] = [];

    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i]!;
      const exampleId = exampleIds[i]!;
      const groundTruth = resolveGroundTruth(c);

      const agentResult = await executeAgentCase(c);
      const inlineOutput = await buildInlineOutputForCase(
        c,
        exampleId,
        groundTruth,
        datasetName,
        agentResult,
      );

      const inlineResult = await client.executeInline(runId, [inlineOutput]);
      const serverResult = inlineResult.results[0];

      const result = buildCaseResult(
        c,
        datasetName,
        groundTruth,
        agentResult,
        serverResult,
      );

      printCaseResult(result);
      caseResults.push(result);
    }

    const finalResult = buildFinalResult(datasetId, runId, caseResults);
    printSummary(finalResult);
    return finalResult;
  }

  // 4 — Run all agent functions concurrently, capturing latency per case
  const agentOutputs = await mapWithConcurrency(
    cases,
    maxCaseConcurrency,
    (c) => executeAgentCase(c),
  );

  // 5 — Evaluate custom metrics client-side
  const inlineOutputs: InlineOutput[] = await Promise.all(
    cases.map(async (c, i) => {
      const agentResult = agentOutputs[i]!;
      const exampleId = exampleIds[i]!;
      const groundTruth = resolveGroundTruth(c);

      return buildInlineOutputForCase(
        c,
        exampleId,
        groundTruth,
        datasetName,
        agentResult,
      );
    }),
  );

  // 6 — POST to backend → built-in metrics scored server-side, merged, persisted
  const inlineResult = await client.executeInline(runId, inlineOutputs);

  // 7 — Merge per-case results with possible agent errors and print
  const caseResults: EvalCaseResult[] = cases.map((c, i) => {
    const agentResult = agentOutputs[i]!;
    const serverResult = inlineResult.results[i];
    const groundTruth = resolveGroundTruth(c);
    const result = buildCaseResult(
      c,
      datasetName,
      groundTruth,
      agentResult,
      serverResult,
    );
    printCaseResult(result);
    return result;
  });

  const finalResult = buildFinalResult(datasetId, runId, caseResults);

  printSummary(finalResult);
  return finalResult;
}

function resolveGroundTruth(c: EvalCase): string {
  const value = c.groundTruth.trim();
  if (!value) {
    throw new Error(`[evalSuite] Case "${c.id}" is missing groundTruth`);
  }
  return value;
}
