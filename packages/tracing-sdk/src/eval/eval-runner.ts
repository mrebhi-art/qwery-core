import { EvalClient } from './eval-client';
import type {
  EvalCase,
  EvalCaseResult,
  EvalSuiteOptions,
  EvalSuiteResult,
  InlineOutput,
  MetricScore,
} from './types';

// ─── Colour helpers (ANSI, graceful fallback) ─────────────────────────────────

const NO_COLOR = typeof process !== 'undefined' && (process.env.NO_COLOR || !process.stdout?.isTTY);

function green(s: string)  { return NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`; }
function red(s: string)    { return NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`; }
function yellow(s: string) { return NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`; }
function bold(s: string)   { return NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`; }
function dim(s: string)    { return NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`; }

// ─── Printing ─────────────────────────────────────────────────────────────────

function printHeader(suiteName: string, datasetName: string): void {
  console.log('');
  console.log(bold(`  ${suiteName}`));
  console.log(dim(`  dataset: ${datasetName}`));
  console.log('');
}

function truncate(s: string, max = 120): string {
  const single = s.replace(/\n/g, ' ').trim();
  return single.length > max ? single.slice(0, max) + '…' : single;
}

function printCaseResult(result: EvalCaseResult): void {
  const icon = result.error ? red('✗') : result.passed ? green('✓') : red('✗');
  const scoreLabel = result.error
    ? ''
    : ` ${dim('(')}${result.score >= 0.8 ? green(result.score.toFixed(2)) : result.score >= 0.5 ? yellow(result.score.toFixed(2)) : red(result.score.toFixed(2))}${dim(')')}`;
  console.log(`  ${icon} ${bold(result.id)}${scoreLabel}`);

  if (result.error) {
    console.log(`    ${red('Error:')} ${result.error}`);
    return;
  }

  // Agent output snippet (always shown)
  if (result.agentOutput) {
    console.log(`    ${dim('Output:')} ${truncate(result.agentOutput)}`);
  }

  // Golden output (only shown on failure, for comparison)
  if (!result.passed && result.goldenOutput) {
    console.log(`    ${dim('Expected:')} ${truncate(result.goldenOutput)}`);
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


function printSummary(result: EvalSuiteResult): void {
  const { total, passed, failed, avgScore } = result.summary;
  const icon = failed === 0 ? green('✓') : red('✗');
  console.log('');
  console.log(
    `  ${icon} ${bold('Summary')}  ${green(String(passed))}/${total} passed · avg score ${avgScore >= 0.8 ? green(avgScore.toFixed(3)) : yellow(avgScore.toFixed(3))}`,
  );
  console.log(dim(`  Results → ${result.runId ? `run ${result.runId}` : 'n/a'}`));
  console.log('');
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
 *       goldenOutput: '4',
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
    agentVersion = process.env['AGENT_VERSION'] ?? '1.0.0',
    metrics = { overall: ['string_similarity'] },
    cases,
  } = options;

  const client = new EvalClient(baseUrl);

  printHeader(suiteName, datasetName);

  // 1 — Find or create the dataset
  console.log(dim('  Creating / resolving dataset…'));
  const datasetId = await client.findOrCreateDataset(datasetName, `Created by evalSuite: ${suiteName}`);

  // 2 — Upload examples (one call; server deduplicates by dataset + input hash if needed)
  console.log(dim('  Uploading examples…'));
  const exampleIds = await client.uploadExamples(
    datasetId,
    cases.map((c) => ({ input: c.input, goldenOutput: c.goldenOutput, metadata: { caseId: c.id } })),
  );

  // 3 — Start an evaluation run
  const runId = await client.startRun({ datasetId, agentVersion, metrics });
  console.log(dim(`  Run ${runId} started`));
  console.log('');

  // 4 — Run all agent functions concurrently, capturing latency per case
  const agentOutputs = await Promise.all(
    cases.map(async (c) => {
      const t0 = Date.now();
      try {
        const output = await c.agent(c.input);
        return { ok: true as const, output, durationMs: Date.now() - t0 };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - t0 };
      }
    }),
  );

  // 5 — Evaluate custom metrics client-side
  const inlineOutputs: InlineOutput[] = await Promise.all(
    cases.map(async (c, i) => {
      const agentResult = agentOutputs[i]!;
      const exampleId = exampleIds[i]!;

      if (!agentResult.ok) {
        return { exampleId, agentOutput: '', customMetrics: [] };
      }

      const customScores: InlineOutput['customMetrics'] = [];
      for (const cm of c.customMetrics ?? []) {
        try {
          const raw = await cm.fn(agentResult.output, c.goldenOutput);
          const score = Math.max(0, Math.min(1, raw));
          customScores.push({ name: cm.name, score, passed: score >= 0.8 });
        } catch {
          customScores.push({ name: cm.name, score: 0, passed: false, detail: 'metric fn threw' });
        }
      }

      return { exampleId, agentOutput: agentResult.output, customMetrics: customScores };
    }),
  );

  // 6 — POST to backend → built-in metrics scored server-side, merged, persisted
  const inlineResult = await client.executeInline(runId, inlineOutputs);

  // 7 — Merge per-case results with possible agent errors and print
  const caseResults: EvalCaseResult[] = cases.map((c, i) => {
    const agentResult = agentOutputs[i]!;
    const serverResult = inlineResult.results[i];
    const exampleId = exampleIds[i]!;

    if (!agentResult.ok) {
      const result: EvalCaseResult = {
        id: c.id,
        input: c.input,
        agentOutput: '',
        goldenOutput: c.goldenOutput,
        metrics: [],
        score: 0,
        passed: false,
        durationMs: agentResult.durationMs,
        error: agentResult.error,
      };
      printCaseResult(result);
      return result;
    }

    // The backend domain uses `metric` as the field name; SDK MetricScore expects `name`.
    const metrics: MetricScore[] = (serverResult?.metrics ?? []).map((m) => ({
      name: (m as unknown as { metric?: string; name?: string }).name ?? (m as unknown as { metric?: string }).metric ?? '(unknown)',
      category: m.category,
      score: m.score,
      passed: m.passed,
      ...(m.detail !== undefined ? { detail: m.detail } : {}),
    }));
    const score = serverResult?.score ?? 0;
    const passed = serverResult?.passed ?? false;

    const result: EvalCaseResult = {
      id: c.id,
      input: c.input,
      agentOutput: agentResult.output,
      goldenOutput: c.goldenOutput,
      metrics,
      score,
      passed,
      durationMs: agentResult.durationMs,
    };
    printCaseResult(result);
    return result;
  });

  const finalResult: EvalSuiteResult = {
    datasetId,
    runId,
    results: caseResults,
    summary: {
      total: inlineResult.total,
      passed: inlineResult.passed,
      failed: inlineResult.failed,
      avgScore: inlineResult.avgScore,
    },
  };

  printSummary(finalResult);
  return finalResult;
}
