/**
 * Latency & Token Usage – single-turn eval suite
 *
 * How to run:
 *   pnpm --filter @qwery/agent-factory-sdk eval:suite:latency
 */

import { evalSuite } from '@qwery/tracing-sdk/eval';
import { runLatencyTokenHarness } from '../_shared/latency-token-agent-harness';
import { latencyTokenDataset } from '../../datasets/single-turn/latency-token.dataset';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MODEL = process.env.EVAL_MODEL ?? 'ollama-cloud/minimax-m2.5';
const AGENT_VERSION = process.env['AGENT_VERSION'] ?? MODEL;

type HarnessPayload = {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
};

function parseHarnessPayload(output: string): HarnessPayload | null {
  try {
    const parsed = JSON.parse(output) as HarnessPayload;
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch {
    return null;
  }
}

function extractSqlLoose(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();

  const sqlInFence = trimmed.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (sqlInFence) return sqlInFence.trim();

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ['query', 'sql', 'sql_query']) {
      const candidate = parsed[key];
      if (typeof candidate === 'string') {
        return candidate.replace(/\\n/g, '\n').trim();
      }
    }
  } catch {
    // ignore
  }

  const keyword = trimmed.match(/\b(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i);
  if (!keyword?.index) {
    return keyword ? trimmed.slice(keyword.index).trim() : trimmed;
  }
  return trimmed.slice(keyword.index).trim();
}

function normalizeSql(sql: string): string {
  return sql
    .toLowerCase()
    .replace(/[`"']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),=<>])\s*/g, '$1')
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(/[^a-z0-9_]+/i).filter(Boolean));
  const tokensB = new Set(b.split(/[^a-z0-9_]+/i).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection += 1;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

const goldens = await latencyTokenDataset.pull();

const result = await evalSuite('Tokens & Latency', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: latencyTokenDataset.name,
  agentVersion: AGENT_VERSION,
  metrics: { overall: [] },
  cases: goldens.map((g) => ({
    ...g,
    agent: (input: string) => runLatencyTokenHarness(input, MODEL),
    customMetrics: [
      {
        name: 'has_structured_payload',
        fn: (out) => (parseHarnessPayload(out) ? 1 : 0),
      },
      {
        name: 'has_non_empty_text',
        fn: (out) => {
          const payload = parseHarnessPayload(out);
          const text = payload?.text ?? out;
          return text.trim().length > 0 ? 1 : 0;
        },
      },
      {
        name: 'sql_semantic_overlap',
        fn: (out, golden) => {
          const payload = parseHarnessPayload(out);
          const responseText = payload?.text ?? out;
          const outputSql = normalizeSql(extractSqlLoose(responseText));
          const goldenSql = normalizeSql(extractSqlLoose(golden));
          if (!goldenSql) return 0;
          if (!outputSql) return 0;
          return tokenOverlap(outputSql, goldenSql);
        },
      },
      {
        name: 'latency_budget_30s',
        fn: (out) => {
          const payload = parseHarnessPayload(out);
          if (!payload || typeof payload.latencyMs !== 'number') return 0;
          return payload.latencyMs <= 30000 ? 1 : 0;
        },
      },
      {
        name: 'token_budget_30k',
        fn: (out) => {
          const payload = parseHarnessPayload(out);
          if (!payload || typeof payload.totalTokens !== 'number') return 0;
          return payload.totalTokens <= 30000 ? 1 : 0;
        },
      },
    ],
  })),
});

const parsedPayloads = result.results
  .map((r) => parseHarnessPayload(r.generatedOutput))
  .filter((p): p is HarnessPayload => !!p);

const totalTokens = parsedPayloads
  .map((p) => p.totalTokens)
  .filter((v): v is number => typeof v === 'number');
const latencyMs = parsedPayloads
  .map((p) => p.latencyMs)
  .filter((v): v is number => typeof v === 'number');

if (totalTokens.length > 0 && latencyMs.length > 0) {
  const avgTokens = totalTokens.reduce((a, b) => a + b, 0) / totalTokens.length;
  const avgLatency = latencyMs.reduce((a, b) => a + b, 0) / latencyMs.length;
  const p95Tokens = percentile(totalTokens, 95);
  const p95Latency = percentile(latencyMs, 95);

  console.log('');
  console.log('─── Latency/Token Insights ─────────────────────────────────────');
  console.log(`Samples parsed: ${parsedPayloads.length}/${result.results.length}`);
  console.log(`Tokens avg:     ${Math.round(avgTokens)} | p95: ${Math.round(p95Tokens)}`);
  console.log(`Latency avg ms: ${Math.round(avgLatency)} | p95: ${Math.round(p95Latency)}`);
  const snapshot = {
    createdAt: new Date().toISOString(),
    datasetName: latencyTokenDataset.name,
    model: MODEL,
    agentVersion: AGENT_VERSION,
    runId: result.runId,
    summary: {
      total: result.summary.total,
      passed: result.summary.passed,
      failed: result.summary.failed,
      avgScore: result.summary.avgScore,
    },
    metrics: {
      sampleCount: parsedPayloads.length,
      avgTokens,
      p95Tokens,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
    },
  };

  const outDir = resolve(process.cwd(), 'evals-regression', 'reports', 'latency-runs');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `latency-${AGENT_VERSION}.json`);
  writeFileSync(outFile, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log(`Snapshot: ${outFile}`);
  console.log('──────────────────────────────────────────────────────────────────');
}

