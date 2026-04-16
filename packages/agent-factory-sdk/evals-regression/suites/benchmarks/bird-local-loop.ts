import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runBirdSingleTurnScriptHarness } from '../_shared/bird-single-turn-script-harness';

type BirdDatasetRow = {
  id: string;
  dbId: string;
  question: string;
  goldenSql: string;
  evidence: string;
  difficulty?: string;
};

type ToolCallSummary = {
  tool: string;
  state?: string;
  query?: string;
  executionTimeMs?: number;
  errorText?: string;
};

type AgentBehavior = {
  sqlAttempts: number;
  successfulSqlAttempts: number;
  failedSqlAttempts: number;
  schemaExplorationSteps: number;
  totalToolCalls: number;
  toolUsageEfficiency: number;
  finalSuccess: boolean;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costInCredits?: number;
};

type HarnessPayload = {
  answer?: string;
  generatedSql?: string;
  sql?: string;
  sqlExecutionTimeMs?: number;
  toolCalls?: ToolCallSummary[];
  agentBehavior?: AgentBehavior;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costInCredits?: number;
    model?: string;
  };
};

type CaseMetrics = {
  status: 'ok' | 'error';
  timeout: boolean;
  durationMs: number;
  sqlNormalizedExactMatch: boolean;
  sqlTokenF1: number;
  sqlExecutionTimeMs?: number;
  tokenUsage?: TokenUsage;
  agentBehavior?: AgentBehavior;
};

type CaseResult = {
  id: string;
  dbId: string;
  difficulty?: string;
  input: string;
  output: string;
  toolCalls: ToolCallSummary[];
  goldenSql: string;
  durationMs: number;
  ok: boolean;
  timeout: boolean;
  error?: string;
  stderr?: string;
  extractedSql?: string;
  metrics: CaseMetrics;
};

function parseCsvEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function resolveSplitFile(splitRaw: string): string {
  const normalized = splitRaw.trim().toLowerCase();
  if (normalized === 'mini_dev_sqlite') return 'mini_dev_sqlite.json';
  if (normalized === 'mini_dev_mysql') return 'mini_dev_mysql.json';
  if (normalized === 'mini_dev_pg' || normalized === 'mini_dev_postgresql') {
    return 'mini_dev_postgresql.json';
  }

  throw new Error(
    `Unsupported BIRD_SPLIT="${splitRaw}". Use mini_dev_sqlite, mini_dev_mysql, or mini_dev_pg.`,
  );
}

function resolveDatasetJsonPath(splitRaw: string): string {
  const explicit = process.env['BIRD_DATASET_JSON'];
  if (explicit && existsSync(explicit)) {
    return resolve(explicit);
  }

  const splitFile = resolveSplitFile(splitRaw);
  const candidates = [
    resolve(
      process.cwd(),
      'evals-regression',
      'data',
      'bird-mini-dev',
      'minidev',
      'minidev',
      'MINIDEV',
      splitFile,
    ),
  ];

  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `Could not resolve BIRD dataset JSON for split "${splitRaw}". Set BIRD_DATASET_JSON explicitly.`,
    );
  }

  return found;
}

function parseBirdRows(datasetPath: string): BirdDatasetRow[] {
  const raw = JSON.parse(readFileSync(datasetPath, 'utf8')) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`Dataset at ${datasetPath} is not an array.`);
  }

  const rows: BirdDatasetRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;

    const dbId = typeof item['db_id'] === 'string' ? item['db_id'] : undefined;
    const question = typeof item['question'] === 'string' ? item['question'] : undefined;
    const goldenSql = typeof item['SQL'] === 'string' ? item['SQL'] : undefined;
    const questionIdRaw = item['question_id'];

    const questionId =
      typeof questionIdRaw === 'string' || typeof questionIdRaw === 'number'
        ? String(questionIdRaw)
        : undefined;

    if (!dbId || !question || !goldenSql || !questionId) continue;

    rows.push({
      id: `${dbId}__${questionId}`,
      dbId,
      question,
      goldenSql,
      evidence: typeof item['evidence'] === 'string' ? item['evidence'] : '',
      ...(typeof item['difficulty'] === 'string'
        ? { difficulty: item['difficulty'] }
        : {}),
    });
  }

  return rows;
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/;+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeTokenUsage(
  usage: HarnessPayload['usage'] | undefined,
): TokenUsage | undefined {
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

function sqlTokenF1(predictedSql: string | undefined, goldenSql: string): number {
  if (!predictedSql || predictedSql.trim().length === 0) return 0;

  const tokenize = (sql: string): string[] =>
    normalizeSql(sql)
      .split(/[^a-z0-9_]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

  const predictedTokens = tokenize(predictedSql);
  const goldenTokens = tokenize(goldenSql);

  if (predictedTokens.length === 0 && goldenTokens.length === 0) return 1;
  if (predictedTokens.length === 0 || goldenTokens.length === 0) return 0;

  const predictedCounts = new Map<string, number>();
  for (const token of predictedTokens) {
    predictedCounts.set(token, (predictedCounts.get(token) ?? 0) + 1);
  }

  const goldenCounts = new Map<string, number>();
  for (const token of goldenTokens) {
    goldenCounts.set(token, (goldenCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  for (const [token, count] of predictedCounts) {
    overlap += Math.min(count, goldenCounts.get(token) ?? 0);
  }

  const precision = overlap / predictedTokens.length;
  const recall = overlap / goldenTokens.length;

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
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

function parseToolCallsBlock(block: string | undefined): ToolCallSummary[] {
  if (!block || block.trim().length === 0) return [];

  try {
    const parsed = JSON.parse(block) as unknown;
    if (!Array.isArray(parsed)) return [];

    const normalized: ToolCallSummary[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const value = item as Record<string, unknown>;
      const tool = typeof value['tool'] === 'string' ? value['tool'] : undefined;
      if (!tool || tool.length === 0) continue;

      normalized.push({
        tool,
        ...(typeof value['state'] === 'string' ? { state: value['state'] } : {}),
        ...(typeof value['query'] === 'string' ? { query: value['query'] } : {}),
        ...(typeof value['executionTimeMs'] === 'number' && Number.isFinite(value['executionTimeMs'])
          ? { executionTimeMs: value['executionTimeMs'] }
          : {}),
        ...(typeof value['errorText'] === 'string' ? { errorText: value['errorText'] } : {}),
      });
    }

    return normalized;
  } catch {
    return [];
  }
}

function parseFailureOutput(errorText: string): {
  header: string;
  output: string;
  toolCalls: ToolCallSummary[];
  extractedSql?: string;
  stderr?: string;
} {
  const normalized = errorText.replace(/\r\n/g, '\n').trim();
  const header = normalized.split('\n')[0]?.trim() ?? 'bird-single-turn failed.';
  const output = extractLabeledBlock(normalized, 'returned:') ?? '';
  const toolCalls = parseToolCallsBlock(extractLabeledBlock(normalized, 'tool_calls:'));
  const extractedSql = extractLabeledBlock(normalized, 'extracted_sql:');
  const stderr = extractLabeledBlock(normalized, 'stderr:');

  return {
    header,
    output,
    toolCalls,
    ...(typeof extractedSql === 'string' ? { extractedSql } : {}),
    ...(typeof stderr === 'string' ? { stderr } : {}),
  };
}

function printMultilineSection(label: string, value: string): void {
  console.log(`    ${label}`);

  const normalized = value.replace(/\r\n/g, '\n').trimEnd();
  if (normalized.trim().length === 0) {
    console.log('      (empty)');
    return;
  }

  for (const line of normalized.split('\n')) {
    console.log(`      ${line}`);
  }
}

function printJsonSection(label: string, value: unknown): void {
  let serialized = 'null';
  try {
    serialized = JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    serialized = '[unserializable]';
  }

  printMultilineSection(label, serialized);
}

function printCaseReport(result: CaseResult): void {
  const status = result.ok ? '[PASS]' : '[FAIL]';
  console.log(`  ${status} ${result.id}`);
  printMultilineSection('input:', result.input);
  printMultilineSection('output:', result.output);
  printJsonSection('tool_calls:', result.toolCalls);
  printMultilineSection('extracted_sql:', result.extractedSql ?? '');
  printMultilineSection('golden_sql:', result.goldenSql);
  printJsonSection('metrics:', result.metrics);

  if (!result.ok && result.error) {
    printMultilineSection('error:', result.error);
  }

  if (!result.ok && result.stderr) {
    printMultilineSection('stderr:', result.stderr);
  }

  console.log('');
}

function parsePayload(output: string): HarnessPayload | null {
  try {
    const parsed = JSON.parse(output) as HarnessPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function timestampSuffix(): string {
  return new Date().toISOString().replace(/[.:]/g, '-');
}

const configuredModel =
  process.env.EVAL_MODEL ??
  process.env.DEFAULT_MODEL ??
  process.env.MODEL ??
  'ollama-cloud/minimax-m2.5';

if (!configuredModel.startsWith('ollama-cloud/')) {
  throw new Error(
    `[bird-local-loop] Only ollama-cloud models are allowed. Received model="${configuredModel}"`,
  );
}

const split = process.env['BIRD_SPLIT'] ?? 'mini_dev_sqlite';
const includeEvidence = process.env['BIRD_INCLUDE_EVIDENCE'] !== '0';
const limit = normalizeLimit(process.env['BIRD_LIMIT'], 10);

const dbFilter = (() => {
  const many = parseCsvEnv('BIRD_DB_IDS');
  if (many.length > 0) return new Set(many);
  const one = process.env['BIRD_DB_ID']?.trim();
  if (one && one.length > 0) return new Set([one]);
  return new Set(['california_schools']);
})();

const difficultyFilter = (() => {
  const values = parseCsvEnv('BIRD_DIFFICULTY').map((entry) => entry.toLowerCase());
  return values.length > 0 ? new Set(values) : null;
})();

const datasetPath = resolveDatasetJsonPath(split);
const allRows = parseBirdRows(datasetPath);

const selectedRows = allRows
  .filter((row) => dbFilter.has(row.dbId))
  .filter((row) =>
    difficultyFilter ? difficultyFilter.has((row.difficulty ?? '').toLowerCase()) : true,
  )
  .slice(0, limit);

if (selectedRows.length === 0) {
  throw new Error(
    `[bird-local-loop] No matching rows found. dbFilter=${Array.from(dbFilter).join(',')} difficulty=${
      difficultyFilter ? Array.from(difficultyFilter).join(',') : 'all'
    } split=${split}`,
  );
}

console.log('');
console.log('  BIRD Local Loop Runner');
console.log(`  model: ${configuredModel}`);
console.log(`  split: ${split}`);
console.log(`  dataset: ${datasetPath}`);
console.log(`  includeEvidence: ${includeEvidence}`);
console.log(`  cases: ${selectedRows.length}`);
console.log(`  dbFilter: ${Array.from(dbFilter).join(',')}`);
console.log(
  `  difficulty: ${difficultyFilter ? Array.from(difficultyFilter).join(',') : 'all'}`,
);
console.log('');

const suiteStartedAtMs = Date.now();
const results: CaseResult[] = [];

for (const row of selectedRows) {
  const caseStartedAtMs = Date.now();
  const input =
    includeEvidence && row.evidence.trim().length > 0
      ? `[Evidence: ${row.evidence}]\n\n${row.question}`
      : row.question;

  try {
    const rawOutput = await runBirdSingleTurnScriptHarness({
      dbId: row.dbId,
      question: input,
      model: configuredModel,
    });

    const durationMs = Date.now() - caseStartedAtMs;
    const payload = parsePayload(rawOutput);
    const output =
      typeof payload?.answer === 'string' && payload.answer.trim().length > 0
        ? payload.answer.trim()
        : rawOutput.trim();
    const extractedSql = payload?.generatedSql ?? payload?.sql;
    const toolCalls = Array.isArray(payload?.toolCalls) ? payload.toolCalls : [];
    const sqlNormalizedExactMatch =
      typeof extractedSql === 'string' && extractedSql.trim().length > 0
        ? normalizeSql(extractedSql) === normalizeSql(row.goldenSql)
        : false;
    const sqlTokenF1Score = sqlTokenF1(extractedSql, row.goldenSql);
    const tokenUsage = normalizeTokenUsage(payload?.usage);

    const metrics: CaseMetrics = {
      status: 'ok',
      timeout: false,
      durationMs,
      sqlNormalizedExactMatch,
      sqlTokenF1: sqlTokenF1Score,
      ...(typeof payload?.sqlExecutionTimeMs === 'number' &&
      Number.isFinite(payload.sqlExecutionTimeMs)
        ? { sqlExecutionTimeMs: payload.sqlExecutionTimeMs }
        : {}),
      ...(tokenUsage ? { tokenUsage } : {}),
      ...(payload?.agentBehavior ? { agentBehavior: payload.agentBehavior } : {}),
    };

    const result: CaseResult = {
      id: row.id,
      dbId: row.dbId,
      ...(row.difficulty ? { difficulty: row.difficulty } : {}),
      input,
      output,
      toolCalls,
      goldenSql: row.goldenSql,
      durationMs,
      ok: true,
      timeout: false,
      ...(typeof extractedSql === 'string' ? { extractedSql } : {}),
      metrics,
    };

    results.push(result);
    printCaseReport(result);
  } catch (error) {
    const durationMs = Date.now() - caseStartedAtMs;
    const message = error instanceof Error ? error.message : String(error);
    const timeout = /timed out after\s+\d+ms/i.test(message);
    const failure = parseFailureOutput(message);
    const extractedSql = failure.extractedSql;
    const sqlNormalizedExactMatch =
      typeof extractedSql === 'string' && extractedSql.trim().length > 0
        ? normalizeSql(extractedSql) === normalizeSql(row.goldenSql)
        : false;
    const sqlTokenF1Score = sqlTokenF1(extractedSql, row.goldenSql);

    const metrics: CaseMetrics = {
      status: 'error',
      timeout,
      durationMs,
      sqlNormalizedExactMatch,
      sqlTokenF1: sqlTokenF1Score,
    };

    const result: CaseResult = {
      id: row.id,
      dbId: row.dbId,
      ...(row.difficulty ? { difficulty: row.difficulty } : {}),
      input,
      output: failure.output,
      toolCalls: failure.toolCalls,
      goldenSql: row.goldenSql,
      durationMs,
      ok: false,
      timeout,
      error: failure.header,
      ...(failure.stderr ? { stderr: failure.stderr } : {}),
      ...(typeof extractedSql === 'string' ? { extractedSql } : {}),
      metrics,
    };

    results.push(result);
    printCaseReport(result);
  }
}

const total = results.length;
const ok = results.filter((result) => result.ok).length;
const failed = total - ok;
const timeouts = results.filter((result) => result.timeout).length;
const sqlExtracted = results.filter(
  (result) => typeof result.extractedSql === 'string' && result.extractedSql.length > 0,
).length;
const sqlExactMatches = results.filter(
  (result) => result.metrics.sqlNormalizedExactMatch === true,
).length;
const avgSqlTokenF1 =
  total > 0
    ? results.reduce((sum, result) => sum + result.metrics.sqlTokenF1, 0) / total
    : 0;
const sqlTokenF1AtLeast80 = results.filter(
  (result) => result.metrics.sqlTokenF1 >= 0.8,
).length;
const totalDurationMs = Date.now() - suiteStartedAtMs;
const avgCaseDurationMs =
  total > 0 ? results.reduce((sum, result) => sum + result.durationMs, 0) / total : 0;

const tokenTotals = results.reduce(
  (acc, result) => {
    if (!result.metrics.tokenUsage) return acc;
    return {
      inputTokens: acc.inputTokens + result.metrics.tokenUsage.inputTokens,
      outputTokens: acc.outputTokens + result.metrics.tokenUsage.outputTokens,
      totalTokens: acc.totalTokens + result.metrics.tokenUsage.totalTokens,
      costInCredits:
        acc.costInCredits +
        (typeof result.metrics.tokenUsage.costInCredits === 'number'
          ? result.metrics.tokenUsage.costInCredits
          : 0),
    };
  },
  { inputTokens: 0, outputTokens: 0, totalTokens: 0, costInCredits: 0 },
);

console.log('');
console.log(
  `  Summary: ok=${ok}/${total}, failed=${failed}, timeouts=${timeouts}, sql_extracted=${sqlExtracted}, sql_exact_match=${sqlExactMatches}, sql_token_f1_ge_0_8=${sqlTokenF1AtLeast80}`,
);
console.log(
  `  Timing: total=${totalDurationMs}ms, avg_case=${avgCaseDurationMs.toFixed(2)}ms`,
);
console.log(`  SQL token F1: avg=${avgSqlTokenF1.toFixed(4)}`);
if (tokenTotals.totalTokens > 0) {
  console.log(
    `  Tokens: in=${tokenTotals.inputTokens}, out=${tokenTotals.outputTokens}, total=${tokenTotals.totalTokens}`,
  );
}

const report = {
  createdAt: new Date().toISOString(),
  config: {
    model: configuredModel,
    split,
    includeEvidence,
    limit,
    dbFilter: Array.from(dbFilter),
    difficultyFilter: difficultyFilter ? Array.from(difficultyFilter) : null,
    datasetPath,
  },
  summary: {
    total,
    ok,
    failed,
    timeouts,
    sqlExtracted,
    sqlExactMatches,
    avgSqlTokenF1,
    sqlTokenF1AtLeast80,
    totalDurationMs,
    avgCaseDurationMs,
    ...(tokenTotals.totalTokens > 0 ? { tokenTotals } : {}),
  },
  results,
};

const reportsDir = resolve(process.cwd(), 'evals-regression', 'reports');
mkdirSync(reportsDir, { recursive: true });
const reportPath = resolve(reportsDir, `bird-local-loop-${timestampSuffix()}.json`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`  Report: ${reportPath}`);
console.log('');
