/// <reference types="node" />

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractSqlFromAgentOutput, normalizeSql, sqlTokenF1 } from './bird-scorer';

const DEFAULT_MAX_ROWS_COMPARE = 2000;
const DEFAULT_MAX_ROWS_PREVIEW = 5;
const SQLITE_CATALOG = 'bird_sqlite';
const DEFAULT_VES_SIMILARITY_THRESHOLD = 0.7;

const FINAL_SCORE_WEIGHTS = {
  syntax: 0.15,
  schema: 0.2,
  structural: 0.25,
  execution: 0.25,
  efficiency: 0.1,
  topK: 0.05,
} as const;

type DuckDbConnection = {
  run: (sql: string) => Promise<{
    getRowObjectsJS: () => Promise<Array<Record<string, unknown>>>;
  }>;
  closeSync: () => void;
};

type DuckDbInstance = {
  connect: () => Promise<DuckDbConnection>;
  closeSync: () => void;
};

type DuckDbModule = {
  DuckDBInstance: {
    create: (path?: string) => Promise<DuckDbInstance>;
  };
};

type BunSqliteDatabase = {
  query: (sql: string) => {
    all: () => Array<Record<string, unknown>>;
  };
  close: () => void;
};

type BunSqliteModule = {
  Database: new (path: string, options?: Record<string, unknown>) => BunSqliteDatabase;
};

export type BirdExecutionConfig = {
  dbRoot?: string;
  requireDbRoot?: boolean;
  maxRowsCompare?: number;
  maxRowsPreview?: number;
};

export type BirdErrorDiagnostics = {
  missing_limit: boolean;
  wrong_join: boolean;
  column_mismatch: boolean;
  missing_where_filter: boolean;
  extra_columns: boolean;
  incorrect_aggregation: boolean;
  schema_mismatch: boolean;
};

export type BirdCompositeEvaluation = {
  syntax_valid: number;
  schema_score: number;
  structural_f1: number;
  execution_score: number;
  top_k_score: number;
  ves: number;
  final_score: number;
  error_type: string;
  diagnostics: BirdErrorDiagnostics;
};

export type BirdAgentBehaviorMetrics = {
  sqlAttemptsBeforeSuccess: number;
  schemaExplorationSteps: number;
  toolUsageEfficiency: number;
  finalSuccessRate: number;
};

export type BirdExecutionEvaluation = {
  extractedSql: string;
  dbPath?: string;
  executionAccuracyEx: number;
  validEfficiencyScoreVes: number;
  softF1Score: number;
  syntaxValidity: number;
  schemaGroundingScore: number;
  structuralF1Score: number;
  softExecutionScore: number;
  topKCorrectnessScore: number;
  finalCompositeScore: number;
  errorType: string;
  diagnostics: BirdErrorDiagnostics;
  compositeEvaluation: BirdCompositeEvaluation;
  agentBehavior?: BirdAgentBehaviorMetrics;
  sqlNormalizedMatch: number;
  sqlTokenF1Score: number;
  predictedDurationMs?: number;
  goldenDurationMs?: number;
  predictedRowCount?: number;
  goldenRowCount?: number;
  predictedTablePreview: Array<Record<string, unknown>>;
  goldenTablePreview: Array<Record<string, unknown>>;
  detail: string;
};

type SqlExecutionResult = {
  ok: boolean;
  rows: Array<Record<string, unknown>>;
  durationMs: number;
  rowCount: number;
  truncated: boolean;
  error?: string;
};

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return fallback;
  return Math.floor(value as number);
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalizeScalar(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    return Number.isInteger(value) ? value : Number(value.toFixed(10));
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeScalar(item));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([k, v]) => [k, normalizeScalar(v)]));
  }
  return value;
}

function normalizeRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => normalizeScalar(row) as Record<string, unknown>);
}

function rowToKey(row: Record<string, unknown>): string {
  return JSON.stringify(normalizeScalar(row));
}

function multiset(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return counts;
}

function compareResults(
  predictedRows: Array<Record<string, unknown>>,
  goldenRows: Array<Record<string, unknown>>,
): {
  ex: number;
  softF1: number;
  precision: number;
  recall: number;
  matched: number;
} {
  const predictedKeys = predictedRows.map(rowToKey);
  const goldenKeys = goldenRows.map(rowToKey);

  const sortedPredicted = [...predictedKeys].sort();
  const sortedGolden = [...goldenKeys].sort();
  const ex =
    sortedPredicted.length === sortedGolden.length &&
    sortedPredicted.every((value, index) => value === sortedGolden[index])
      ? 1
      : 0;

  if (predictedKeys.length === 0 && goldenKeys.length === 0) {
    return { ex, softF1: 1, precision: 1, recall: 1, matched: 0 };
  }
  if (predictedKeys.length === 0 || goldenKeys.length === 0) {
    return { ex, softF1: 0, precision: 0, recall: 0, matched: 0 };
  }

  const predictedCounts = multiset(predictedKeys);
  const goldenCounts = multiset(goldenKeys);

  let matched = 0;
  for (const [key, count] of predictedCounts) {
    matched += Math.min(count, goldenCounts.get(key) ?? 0);
  }

  const precision = matched / predictedKeys.length;
  const recall = matched / goldenKeys.length;
  const softF1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { ex, softF1, precision, recall, matched };
}

function computeVes(ex: number, predictedDurationMs: number, goldenDurationMs: number): number {
  if (ex < 1) return 0;
  if (predictedDurationMs <= 0 || goldenDurationMs <= 0) return 0;
  return Math.max(0, Math.min(1, goldenDurationMs / predictedDurationMs));
}

type SqlShape = {
  tables: Set<string>;
  columns: Set<string>;
  selectItems: Set<string>;
  joinItems: Set<string>;
  wherePredicates: Set<string>;
  groupByItems: Set<string>;
  orderByItems: Set<string>;
  limitItems: Set<string>;
  aggregateFunctions: Set<string>;
  hasOrderBy: boolean;
  hasLimit: boolean;
  limitValue: number | null;
};

type OrderedComparison = {
  orderedExact: number;
  top1Correct: number;
  topKOverlapRatio: number;
  topKCorrectness: number;
};

type StructuredAgentBehaviorPayload = {
  sqlAttempts?: unknown;
  successfulSqlAttempts?: unknown;
  failedSqlAttempts?: unknown;
  schemaExplorationSteps?: unknown;
  totalToolCalls?: unknown;
  toolUsageEfficiency?: unknown;
  finalSuccess?: unknown;
};

const SQL_RESERVED_WORDS = new Set(
  [
    'select',
    'from',
    'where',
    'join',
    'left',
    'right',
    'inner',
    'outer',
    'full',
    'cross',
    'on',
    'as',
    'and',
    'or',
    'not',
    'null',
    'is',
    'in',
    'like',
    'exists',
    'between',
    'union',
    'intersect',
    'except',
    'group',
    'by',
    'order',
    'having',
    'limit',
    'offset',
    'asc',
    'desc',
    'distinct',
    'case',
    'when',
    'then',
    'else',
    'end',
    'with',
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'cast',
    'coalesce',
    'substr',
    'date',
    'datetime',
    'true',
    'false',
  ],
);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeClauseValue(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stripSqlLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, ' ')
    .replace(/"(?:""|[^"])*"/g, ' ')
    .replace(/`(?:``|[^`])*`/g, ' ');
}

function splitTopLevelComma(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      items.push(value.slice(start, index));
      start = index + 1;
    }
  }
  items.push(value.slice(start));
  return items
    .map((item) => normalizeClauseValue(item))
    .filter(Boolean);
}

function getClause(sql: string, pattern: RegExp): string {
  const match = pattern.exec(sql);
  return match?.[1] ? match[1] : '';
}

function getLimitValue(sql: string): number | null {
  const match = /\blimit\s+(\d+)\b/i.exec(sql);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.floor(value) : null;
}

function extractTableAliases(sql: string): Set<string> {
  const aliases = new Set<string>();
  const regex = /\b(?:from|join)\s+([a-z_][a-z0-9_\.]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;
  for (const match of sql.matchAll(regex)) {
    const alias = match[2]?.toLowerCase();
    if (alias && !SQL_RESERVED_WORDS.has(alias)) {
      aliases.add(alias);
    }
  }
  return aliases;
}

function extractTables(sql: string): Set<string> {
  const tables = new Set<string>();
  const regex = /\b(?:from|join|update|into)\s+([a-z_][a-z0-9_\.]*)/gi;
  for (const match of sql.matchAll(regex)) {
    const tableName = match[1]?.toLowerCase();
    if (tableName && !tableName.startsWith('select')) {
      tables.add(tableName);
    }
  }
  return tables;
}

function extractColumns(sql: string): Set<string> {
  const columns = new Set<string>();
  const aliases = extractTableAliases(sql);

  const dotted = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;
  for (const match of sql.matchAll(dotted)) {
    const column = match[2]?.toLowerCase();
    if (column && !SQL_RESERVED_WORDS.has(column)) {
      columns.add(column);
    }
  }

  const identifier = /\b([a-z_][a-z0-9_]*)\b/gi;
  for (const match of sql.matchAll(identifier)) {
    const token = match[1]?.toLowerCase();
    if (!token || SQL_RESERVED_WORDS.has(token) || aliases.has(token)) {
      continue;
    }
    const nextChar = sql[match.index! + match[0].length];
    if (nextChar === '(') {
      continue;
    }
    columns.add(token);
  }

  return columns;
}

function setOverlap<T>(left: Set<T>, right: Set<T>): number {
  let overlap = 0;
  for (const item of left) {
    if (right.has(item)) overlap += 1;
  }
  return overlap;
}

function jaccardScore<T>(left: Set<T>, right: Set<T>): number {
  if (left.size === 0 && right.size === 0) return 1;
  const overlap = setOverlap(left, right);
  const union = left.size + right.size - overlap;
  if (union <= 0) return 1;
  return overlap / union;
}

function setF1Score<T>(predicted: Set<T>, golden: Set<T>): number {
  if (predicted.size === 0 && golden.size === 0) return 1;
  if (predicted.size === 0 || golden.size === 0) return 0;
  const overlap = setOverlap(predicted, golden);
  const precision = overlap / predicted.size;
  const recall = overlap / golden.size;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

function extractSetFromClause(sql: string, pattern: RegExp): Set<string> {
  const clause = getClause(sql, pattern);
  if (!clause) return new Set<string>();
  const values = splitTopLevelComma(clause)
    .map((value) =>
      value
        .replace(/\s+as\s+[a-z_][a-z0-9_]*$/i, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
  return new Set(values.map((value) => value.toLowerCase()));
}

function extractJoinItems(sql: string): Set<string> {
  const items = new Set<string>();
  const regex =
    /\bjoin\s+([a-z_][a-z0-9_\.]*)(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+on\s+([\s\S]*?)(?=\bjoin\b|\bwhere\b|\bgroup\s+by\b|\border\s+by\b|\blimit\b|\bhaving\b|$)/gi;
  for (const match of sql.matchAll(regex)) {
    const table = normalizeClauseValue(match[1] ?? '');
    const condition = normalizeClauseValue(match[2] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!table) continue;
    items.add(`${table}|${condition}`);
  }
  return items;
}

function extractWherePredicates(sql: string): Set<string> {
  const whereClause = getClause(
    sql,
    /\bwhere\b([\s\S]*?)(?=\bgroup\s+by\b|\border\s+by\b|\blimit\b|\bhaving\b|$)/i,
  );
  if (!whereClause) return new Set<string>();

  const parts = whereClause
    .split(/\band\b|\bor\b/gi)
    .map((part) => normalizeClauseValue(part).replace(/^\(+|\)+$/g, ''))
    .filter(Boolean);
  return new Set(parts);
}

function extractOrderByItems(sql: string): Set<string> {
  const clause = getClause(sql, /\border\s+by\b([\s\S]*?)(?=\blimit\b|$)/i);
  if (!clause) return new Set<string>();
  const normalized = splitTopLevelComma(clause)
    .map((item) => item.replace(/\s+(asc|desc)\b/gi, '').trim())
    .filter(Boolean);
  return new Set(normalized);
}

function extractAggregateFunctions(sql: string): Set<string> {
  const functions = new Set<string>();
  const regex = /\b(count|sum|avg|min|max)\s*\(/gi;
  for (const match of sql.matchAll(regex)) {
    const fn = match[1]?.toLowerCase();
    if (fn) functions.add(fn);
  }
  return functions;
}

function analyzeSqlShape(sql: string): SqlShape {
  const sanitized = stripSqlLiteralsAndComments(sql);

  const selectItems = extractSetFromClause(
    sanitized,
    /\bselect\b([\s\S]*?)\bfrom\b/i,
  );
  const groupByItems = extractSetFromClause(
    sanitized,
    /\bgroup\s+by\b([\s\S]*?)(?=\border\s+by\b|\blimit\b|\bhaving\b|$)/i,
  );

  const orderByItems = extractOrderByItems(sanitized);
  const wherePredicates = extractWherePredicates(sanitized);
  const joinItems = extractJoinItems(sanitized);
  const limitValue = getLimitValue(sanitized);
  const limitItems = new Set<string>(limitValue == null ? [] : [String(limitValue)]);
  const aggregateFunctions = extractAggregateFunctions(sanitized);

  return {
    tables: extractTables(sanitized),
    columns: extractColumns(sanitized),
    selectItems,
    joinItems,
    wherePredicates,
    groupByItems,
    orderByItems,
    limitItems,
    aggregateFunctions,
    hasOrderBy: /\border\s+by\b/i.test(sanitized),
    hasLimit: limitValue != null,
    limitValue,
  };
}

function inferSyntaxValidity(sql: string, executionError?: string): number {
  const normalized = sql.trim();
  if (!normalized) return 0;
  if (executionError && /parser|syntax\s+error|near\s+"/i.test(executionError)) {
    return 0;
  }
  return /^\s*(select|with|insert|update|delete)\b/i.test(normalized) ? 1 : 0;
}

function compareOrderedResults(
  predictedRows: Array<Record<string, unknown>>,
  goldenRows: Array<Record<string, unknown>>,
  topK: number,
): OrderedComparison {
  if (predictedRows.length === 0 && goldenRows.length === 0) {
    return {
      orderedExact: 1,
      top1Correct: 1,
      topKOverlapRatio: 1,
      topKCorrectness: 1,
    };
  }

  const predictedKeys = predictedRows.map(rowToKey);
  const goldenKeys = goldenRows.map(rowToKey);

  const orderedExact =
    predictedKeys.length === goldenKeys.length &&
    predictedKeys.every((value, index) => value === goldenKeys[index])
      ? 1
      : 0;

  const top1Correct =
    predictedKeys.length > 0 && goldenKeys.length > 0 && predictedKeys[0] === goldenKeys[0]
      ? 1
      : 0;

  const normalizedTopK = Math.max(1, topK);
  const predictedTop = predictedKeys.slice(0, normalizedTopK);
  const goldenTop = goldenKeys.slice(0, normalizedTopK);
  const predictedTopSet = new Set(predictedTop);
  let overlapCount = 0;
  for (const rowKey of goldenTop) {
    if (predictedTopSet.has(rowKey)) overlapCount += 1;
  }

  const topKOverlapRatio =
    goldenTop.length === 0 ? 0 : clamp01(overlapCount / goldenTop.length);
  const topKCorrectness = overlapCount > 0 ? 1 : 0;

  return {
    orderedExact,
    top1Correct,
    topKOverlapRatio,
    topKCorrectness,
  };
}

function computeSoftExecutionScore(params: {
  setExact: number;
  setSoftF1: number;
  isRanking: boolean;
  orderedExact: number;
  top1Correct: number;
  topKOverlapRatio: number;
}): number {
  const {
    setExact,
    setSoftF1,
    isRanking,
    orderedExact,
    top1Correct,
    topKOverlapRatio,
  } = params;

  if (orderedExact === 1 || setExact === 1) return 1;
  if (isRanking && top1Correct === 1) return 0.9;

  const overlapSignal = isRanking ? Math.max(setSoftF1, topKOverlapRatio) : setSoftF1;
  if (overlapSignal <= 0) return 0;

  return 0.6 + 0.2 * clamp01(overlapSignal);
}

function buildDiagnostics(params: {
  predicted: SqlShape;
  golden: SqlShape;
  schemaScore: number;
  softExecutionScore: number;
  syntaxValidity: number;
}): { diagnostics: BirdErrorDiagnostics; errorType: string } {
  const { predicted, golden, schemaScore, softExecutionScore, syntaxValidity } = params;

  const missingLimit = golden.hasLimit && !predicted.hasLimit;
  const wrongJoin =
    golden.joinItems.size > 0 && setF1Score(predicted.joinItems, golden.joinItems) < 1;
  const columnMismatch = jaccardScore(predicted.columns, golden.columns) < 1;

  const whereOverlap = setOverlap(predicted.wherePredicates, golden.wherePredicates);
  const missingWhereFilter =
    golden.wherePredicates.size > 0 && whereOverlap < golden.wherePredicates.size;

  const extraColumns =
    golden.selectItems.size > 0 &&
    Array.from(predicted.selectItems).some((item) => !golden.selectItems.has(item));

  const aggregationMismatch =
    setF1Score(predicted.aggregateFunctions, golden.aggregateFunctions) < 1 ||
    predicted.groupByItems.size !== golden.groupByItems.size;

  const schemaMismatch = schemaScore < 0.5;

  const diagnostics: BirdErrorDiagnostics = {
    missing_limit: missingLimit,
    wrong_join: wrongJoin,
    column_mismatch: columnMismatch,
    missing_where_filter: missingWhereFilter,
    extra_columns: extraColumns,
    incorrect_aggregation: aggregationMismatch,
    schema_mismatch: schemaMismatch,
  };

  const errorType =
    syntaxValidity === 0
      ? 'syntax_error'
      : diagnostics.schema_mismatch
        ? 'schema_mismatch'
        : diagnostics.wrong_join
          ? 'wrong_join'
          : diagnostics.missing_where_filter
            ? 'missing_where_filter'
            : diagnostics.missing_limit
              ? 'missing_limit'
              : diagnostics.incorrect_aggregation
                ? 'incorrect_aggregation'
                : diagnostics.extra_columns
                  ? 'extra_columns'
                  : diagnostics.column_mismatch
                    ? 'column_mismatch'
                    : softExecutionScore < 0.7
                      ? 'execution_mismatch'
                      : 'none';

  return { diagnostics, errorType };
}

function parseNumberLike(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseAgentBehaviorFromOutput(
  output: string,
): BirdAgentBehaviorMetrics | undefined {
  const trimmed = output.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const behavior = parsed['agentBehavior'] as StructuredAgentBehaviorPayload | undefined;
    if (!behavior || typeof behavior !== 'object') {
      return undefined;
    }

    const sqlAttempts = Math.max(0, Math.floor(parseNumberLike(behavior.sqlAttempts, 0)));
    const schemaExplorationSteps = Math.max(
      0,
      Math.floor(parseNumberLike(behavior.schemaExplorationSteps, 0)),
    );
    const toolUsageEfficiency = clamp01(parseNumberLike(behavior.toolUsageEfficiency, 0));
    const finalSuccess =
      typeof behavior.finalSuccess === 'boolean'
        ? behavior.finalSuccess
        : parseNumberLike(behavior.finalSuccess, 0) > 0;

    return {
      sqlAttemptsBeforeSuccess: sqlAttempts,
      schemaExplorationSteps,
      toolUsageEfficiency,
      finalSuccessRate: finalSuccess ? 1 : 0,
    };
  } catch {
    return undefined;
  }
}

function buildCompositeEvaluation(params: {
  syntaxValidity: number;
  schemaGroundingScore: number;
  structuralF1Score: number;
  softExecutionScore: number;
  topKCorrectnessScore: number;
  vesScore: number;
  errorType: string;
  diagnostics: BirdErrorDiagnostics;
}): BirdCompositeEvaluation {
  const {
    syntaxValidity,
    schemaGroundingScore,
    structuralF1Score,
    softExecutionScore,
    topKCorrectnessScore,
    vesScore,
    errorType,
    diagnostics,
  } = params;

  const finalScore = clamp01(
    FINAL_SCORE_WEIGHTS.syntax * syntaxValidity +
      FINAL_SCORE_WEIGHTS.schema * schemaGroundingScore +
      FINAL_SCORE_WEIGHTS.structural * structuralF1Score +
      FINAL_SCORE_WEIGHTS.execution * softExecutionScore +
      FINAL_SCORE_WEIGHTS.efficiency * vesScore +
      FINAL_SCORE_WEIGHTS.topK * topKCorrectnessScore,
  );

  return {
    syntax_valid: syntaxValidity,
    schema_score: schemaGroundingScore,
    structural_f1: structuralF1Score,
    execution_score: softExecutionScore,
    top_k_score: topKCorrectnessScore,
    ves: vesScore,
    final_score: finalScore,
    error_type: errorType,
    diagnostics,
  };
}

function averageScore(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveBirdDbRoot(config?: BirdExecutionConfig): string | null {
  const candidate =
    config?.dbRoot ??
    process.env['BIRD_SQLITE_ROOT'] ??
    process.env['BIRD_DB_ROOT'] ??
    process.env['BIRD_DATASET_ROOT'] ??
    null;
  if (!candidate) return null;
  return resolve(candidate);
}

export function resolveBirdSqlitePath(
  dbId: string,
  config?: BirdExecutionConfig,
): string | null {
  const root = resolveBirdDbRoot(config);
  if (!root) return null;

  const candidates = [
    resolve(root, dbId, `${dbId}.sqlite`),
    resolve(root, dbId, 'database.sqlite'),
    resolve(root, `${dbId}.sqlite`),
    resolve(root, 'database', dbId, `${dbId}.sqlite`),
    resolve(root, 'mini_dev_sqlite', dbId, `${dbId}.sqlite`),
    resolve(root, 'dev_databases', dbId, `${dbId}.sqlite`),
    resolve(root, 'train_databases', dbId, `${dbId}.sqlite`),
  ];

  return candidates.find((path) => existsSync(path)) ?? null;
}

async function importDuckDb(): Promise<DuckDbModule> {
  const dynamicImport = new Function(
    'modulePath',
    'return import(modulePath);',
  ) as (modulePath: string) => Promise<unknown>;

  try {
    return (await dynamicImport('@duckdb/node-api')) as DuckDbModule;
  } catch (directError) {
    try {
      const require = createRequire(import.meta.url);
      const resolvedModulePath = require.resolve('@duckdb/node-api', {
        paths: [process.cwd()],
      });
      return (await dynamicImport(pathToFileURL(resolvedModulePath).href)) as DuckDbModule;
    } catch (fallbackError) {
      const directMessage =
        directError instanceof Error ? directError.message : String(directError);
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Unable to load @duckdb/node-api. direct=${directMessage}; fallback=${fallbackMessage}`,
      );
    }
  }
}

async function executeSqlAgainstBirdDb(
  sqlitePath: string,
  sql: string,
  maxRowsCompare: number,
): Promise<SqlExecutionResult> {
  const query = sql.replace(/;\s*$/g, '').trim();
  if (!query) {
    return {
      ok: false,
      rows: [],
      durationMs: 0,
      rowCount: 0,
      truncated: false,
      error: 'SQL is empty after extraction',
    };
  }

  const isBunRuntime =
    typeof globalThis === 'object' && 'Bun' in globalThis && Boolean((globalThis as { Bun?: unknown }).Bun);

  if (isBunRuntime) {
    let db: BunSqliteDatabase | null = null;
    try {
      const dynamicImport = new Function(
        'modulePath',
        'return import(modulePath);',
      ) as (modulePath: string) => Promise<unknown>;
      const bunSqlite = (await dynamicImport('bun:sqlite')) as BunSqliteModule;
      db = new bunSqlite.Database(sqlitePath, { readonly: true, strict: false });

      const startedAt = Date.now();
      const rowObjects = db
        .query(
          `SELECT *
             FROM (${query}) AS __bird_eval_subquery
            LIMIT ${Math.max(1, maxRowsCompare + 1)};`,
        )
        .all();
      const durationMs = Date.now() - startedAt;

      const truncated = rowObjects.length > maxRowsCompare;
      const rows = normalizeRows(truncated ? rowObjects.slice(0, maxRowsCompare) : rowObjects);

      return {
        ok: true,
        rows,
        durationMs,
        rowCount: rowObjects.length,
        truncated,
      };
    } catch (error) {
      return {
        ok: false,
        rows: [],
        durationMs: 0,
        rowCount: 0,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      try {
        db?.close();
      } catch {
        // best effort
      }
    }
  }

  let instance: DuckDbInstance | null = null;
  let connection: DuckDbConnection | null = null;

  try {
    const duckdb = await importDuckDb();
    instance = await duckdb.DuckDBInstance.create(':memory:');
    connection = await instance.connect();

    try {
      await connection.run('INSTALL sqlite;');
    } catch {
      // sqlite extension may already be bundled or installed.
    }
    await connection.run('LOAD sqlite;');

    const escapedPath = escapeSqlLiteral(sqlitePath);
    await connection.run(
      `ATTACH '${escapedPath}' AS ${quoteIdentifier(SQLITE_CATALOG)} (TYPE SQLITE);`,
    );

    const tableResult = await connection.run(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_catalog = '${escapeSqlLiteral(SQLITE_CATALOG)}'
          AND table_schema = 'main'`,
    );

    const tableRows = (await tableResult.getRowObjectsJS()) as Array<{
      table_name?: unknown;
    }>;
    const tableNames = tableRows
      .map((row) => (typeof row.table_name === 'string' ? row.table_name : null))
      .filter((name): name is string => Boolean(name));

    for (const tableName of tableNames) {
      const escapedTableName = quoteIdentifier(tableName);
      await connection.run(
        `CREATE OR REPLACE VIEW ${escapedTableName} AS
         SELECT *
           FROM ${quoteIdentifier(SQLITE_CATALOG)}.main.${escapedTableName};`,
      );
    }

    const startedAt = Date.now();
    const queryResult = await connection.run(
      `SELECT *
         FROM (${query}) AS __bird_eval_subquery
        LIMIT ${Math.max(1, maxRowsCompare + 1)};`,
    );
    const durationMs = Date.now() - startedAt;

    const rowObjects = (await queryResult.getRowObjectsJS()) as Array<Record<string, unknown>>;
    const truncated = rowObjects.length > maxRowsCompare;
    const rows = normalizeRows(truncated ? rowObjects.slice(0, maxRowsCompare) : rowObjects);

    return {
      ok: true,
      rows,
      durationMs,
      rowCount: rowObjects.length,
      truncated,
    };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      durationMs: 0,
      rowCount: 0,
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      connection?.closeSync();
    } catch {
      // best effort
    }
    try {
      instance?.closeSync();
    } catch {
      // best effort
    }
  }
}

function toPreview(
  rows: Array<Record<string, unknown>>,
  maxRowsPreview: number,
): Array<Record<string, unknown>> {
  return rows.slice(0, maxRowsPreview);
}

export async function evaluateBirdExecutionMetrics(params: {
  dbId: string;
  generatedOutput: string;
  goldenSql: string;
  config?: BirdExecutionConfig;
}): Promise<BirdExecutionEvaluation> {
  const { dbId, generatedOutput, goldenSql, config } = params;
  const extractedSql = extractSqlFromAgentOutput(generatedOutput);
  const agentBehavior = parseAgentBehaviorFromOutput(generatedOutput);
  const sqlNormalizedMatch = normalizeSql(extractedSql) === normalizeSql(goldenSql) ? 1 : 0;
  const sqlTokenF1Score = sqlTokenF1(extractedSql, goldenSql);

  const predictedShape = analyzeSqlShape(extractedSql);
  const goldenShape = analyzeSqlShape(goldenSql);

  const tableJaccard = jaccardScore(predictedShape.tables, goldenShape.tables);
  const columnJaccard = jaccardScore(predictedShape.columns, goldenShape.columns);
  const schemaGroundingScore = clamp01(0.4 * tableJaccard + 0.6 * columnJaccard);

  const structuralF1Score = clamp01(
    averageScore([
      setF1Score(predictedShape.selectItems, goldenShape.selectItems),
      setF1Score(predictedShape.joinItems, goldenShape.joinItems),
      setF1Score(predictedShape.wherePredicates, goldenShape.wherePredicates),
      setF1Score(predictedShape.groupByItems, goldenShape.groupByItems),
      setF1Score(predictedShape.orderByItems, goldenShape.orderByItems),
      setF1Score(predictedShape.limitItems, goldenShape.limitItems),
    ]),
  );

  const isRankingQuery = goldenShape.hasOrderBy && goldenShape.hasLimit;
  const topK = goldenShape.limitValue && goldenShape.limitValue > 0 ? goldenShape.limitValue : 5;
  const vesSimilarityThreshold = (() => {
    const value = Number(
      process.env['BIRD_VES_SIMILARITY_THRESHOLD'] ?? DEFAULT_VES_SIMILARITY_THRESHOLD,
    );
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VES_SIMILARITY_THRESHOLD;
  })();

  const maxRowsCompare = normalizeLimit(config?.maxRowsCompare, DEFAULT_MAX_ROWS_COMPARE);
  const maxRowsPreview = normalizeLimit(config?.maxRowsPreview, DEFAULT_MAX_ROWS_PREVIEW);

  const dbPath = resolveBirdSqlitePath(dbId, config);
  const requireDbRoot = config?.requireDbRoot ?? false;

  const syntaxValidityWithoutExecution = inferSyntaxValidity(extractedSql);

  if (!dbPath) {
    const detail = requireDbRoot
      ? 'Real BIRD SQLite database is required but not found. Set BIRD_SQLITE_ROOT (or BIRD_DB_ROOT) to the dataset root.'
      : 'Real BIRD SQLite database not found. Set BIRD_SQLITE_ROOT (or BIRD_DB_ROOT) to the dataset root.';

    const softExecutionScore = 0;
    const topKCorrectnessScore = isRankingQuery ? 0 : 1;
    const { diagnostics, errorType } = buildDiagnostics({
      predicted: predictedShape,
      golden: goldenShape,
      schemaScore: schemaGroundingScore,
      softExecutionScore,
      syntaxValidity: syntaxValidityWithoutExecution,
    });
    const compositeEvaluation = buildCompositeEvaluation({
      syntaxValidity: syntaxValidityWithoutExecution,
      schemaGroundingScore,
      structuralF1Score,
      softExecutionScore,
      topKCorrectnessScore,
      vesScore: 0,
      errorType,
      diagnostics,
    });

    return {
      extractedSql,
      executionAccuracyEx: 0,
      validEfficiencyScoreVes: 0,
      softF1Score: 0,
      syntaxValidity: syntaxValidityWithoutExecution,
      schemaGroundingScore,
      structuralF1Score,
      softExecutionScore,
      topKCorrectnessScore,
      finalCompositeScore: compositeEvaluation.final_score,
      errorType,
      diagnostics,
      compositeEvaluation,
      ...(agentBehavior ? { agentBehavior } : {}),
      sqlNormalizedMatch,
      sqlTokenF1Score,
      predictedTablePreview: [],
      goldenTablePreview: [],
      detail,
    };
  }

  if (!extractedSql.trim()) {
    const softExecutionScore = 0;
    const topKCorrectnessScore = isRankingQuery ? 0 : 1;
    const { diagnostics, errorType } = buildDiagnostics({
      predicted: predictedShape,
      golden: goldenShape,
      schemaScore: schemaGroundingScore,
      softExecutionScore,
      syntaxValidity: 0,
    });
    const compositeEvaluation = buildCompositeEvaluation({
      syntaxValidity: 0,
      schemaGroundingScore,
      structuralF1Score,
      softExecutionScore,
      topKCorrectnessScore,
      vesScore: 0,
      errorType,
      diagnostics,
    });

    return {
      extractedSql,
      dbPath,
      executionAccuracyEx: 0,
      validEfficiencyScoreVes: 0,
      softF1Score: 0,
      syntaxValidity: 0,
      schemaGroundingScore,
      structuralF1Score,
      softExecutionScore,
      topKCorrectnessScore,
      finalCompositeScore: compositeEvaluation.final_score,
      errorType,
      diagnostics,
      compositeEvaluation,
      ...(agentBehavior ? { agentBehavior } : {}),
      sqlNormalizedMatch,
      sqlTokenF1Score,
      predictedTablePreview: [],
      goldenTablePreview: [],
      detail: 'No SQL could be extracted from the generated output.',
    };
  }

  const [predictedResult, goldenResult] = await Promise.all([
    executeSqlAgainstBirdDb(dbPath, extractedSql, maxRowsCompare),
    executeSqlAgainstBirdDb(dbPath, goldenSql, maxRowsCompare),
  ]);

  if (!predictedResult.ok || !goldenResult.ok) {
    const syntaxValidity = inferSyntaxValidity(extractedSql, predictedResult.error);
    const softExecutionScore = 0;
    const topKCorrectnessScore = isRankingQuery ? 0 : 1;
    const { diagnostics, errorType } = buildDiagnostics({
      predicted: predictedShape,
      golden: goldenShape,
      schemaScore: schemaGroundingScore,
      softExecutionScore,
      syntaxValidity,
    });
    const compositeEvaluation = buildCompositeEvaluation({
      syntaxValidity,
      schemaGroundingScore,
      structuralF1Score,
      softExecutionScore,
      topKCorrectnessScore,
      vesScore: 0,
      errorType,
      diagnostics,
    });

    const detail =
      !predictedResult.ok && !goldenResult.ok
        ? `Both queries failed. predicted=${predictedResult.error}; golden=${goldenResult.error}`
        : !predictedResult.ok
          ? `Predicted query failed: ${predictedResult.error}`
          : `Golden query failed: ${goldenResult.error}`;

    return {
      extractedSql,
      dbPath,
      executionAccuracyEx: 0,
      validEfficiencyScoreVes: 0,
      softF1Score: 0,
      syntaxValidity,
      schemaGroundingScore,
      structuralF1Score,
      softExecutionScore,
      topKCorrectnessScore,
      finalCompositeScore: compositeEvaluation.final_score,
      errorType,
      diagnostics,
      compositeEvaluation,
      ...(agentBehavior ? { agentBehavior } : {}),
      sqlNormalizedMatch,
      sqlTokenF1Score,
      predictedDurationMs: predictedResult.durationMs,
      goldenDurationMs: goldenResult.durationMs,
      predictedRowCount: predictedResult.rowCount,
      goldenRowCount: goldenResult.rowCount,
      predictedTablePreview: toPreview(predictedResult.rows, maxRowsPreview),
      goldenTablePreview: toPreview(goldenResult.rows, maxRowsPreview),
      detail,
    };
  }

  const compared = compareResults(predictedResult.rows, goldenResult.rows);
  const ordered = compareOrderedResults(predictedResult.rows, goldenResult.rows, topK);
  const syntaxValidity = inferSyntaxValidity(extractedSql, predictedResult.error);
  const topKCorrectnessScore = isRankingQuery ? ordered.topKCorrectness : 1;
  const softExecutionScore = computeSoftExecutionScore({
    setExact: compared.ex,
    setSoftF1: compared.softF1,
    isRanking: isRankingQuery,
    orderedExact: ordered.orderedExact,
    top1Correct: ordered.top1Correct,
    topKOverlapRatio: ordered.topKOverlapRatio,
  });
  const ves =
    softExecutionScore >= vesSimilarityThreshold
      ? computeVes(1, predictedResult.durationMs, goldenResult.durationMs)
      : 0;
  const { diagnostics, errorType } = buildDiagnostics({
    predicted: predictedShape,
    golden: goldenShape,
    schemaScore: schemaGroundingScore,
    softExecutionScore,
    syntaxValidity,
  });
  const compositeEvaluation = buildCompositeEvaluation({
    syntaxValidity,
    schemaGroundingScore,
    structuralF1Score,
    softExecutionScore,
    topKCorrectnessScore,
    vesScore: ves,
    errorType,
    diagnostics,
  });

  const predictedPreview = toPreview(predictedResult.rows, maxRowsPreview);
  const goldenPreview = toPreview(goldenResult.rows, maxRowsPreview);

  const detailParts = [
    `db=${dbId}`,
    `syntax=${syntaxValidity.toFixed(2)}`,
    `schema=${schemaGroundingScore.toFixed(3)}`,
    `structural=${structuralF1Score.toFixed(3)}`,
    `ex=${compared.ex.toFixed(2)}`,
    `soft_f1=${compared.softF1.toFixed(3)}`,
    `exec_soft=${softExecutionScore.toFixed(3)}`,
    `top_k=${topKCorrectnessScore.toFixed(2)}`,
    `precision=${compared.precision.toFixed(3)}`,
    `recall=${compared.recall.toFixed(3)}`,
    `ves=${ves.toFixed(3)}`,
    `final=${compositeEvaluation.final_score.toFixed(3)}`,
    `error_type=${errorType}`,
    `pred_ms=${predictedResult.durationMs}`,
    `gold_ms=${goldenResult.durationMs}`,
    `pred_rows=${predictedResult.rowCount}`,
    `gold_rows=${goldenResult.rowCount}`,
    predictedResult.truncated || goldenResult.truncated ? 'rows_truncated=1' : null,
  ].filter((part): part is string => Boolean(part));

  return {
    extractedSql,
    dbPath,
    executionAccuracyEx: compared.ex,
    validEfficiencyScoreVes: ves,
    softF1Score: compared.softF1,
    syntaxValidity,
    schemaGroundingScore,
    structuralF1Score,
    softExecutionScore,
    topKCorrectnessScore,
    finalCompositeScore: compositeEvaluation.final_score,
    errorType,
    diagnostics,
    compositeEvaluation,
    ...(agentBehavior ? { agentBehavior } : {}),
    sqlNormalizedMatch,
    sqlTokenF1Score,
    predictedDurationMs: predictedResult.durationMs,
    goldenDurationMs: goldenResult.durationMs,
    predictedRowCount: predictedResult.rowCount,
    goldenRowCount: goldenResult.rowCount,
    predictedTablePreview: predictedPreview,
    goldenTablePreview: goldenPreview,
    detail: detailParts.join(' | '),
  };
}
