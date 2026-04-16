import { extractSqlFromText } from '../../sql-extract';

const SQL_KEYWORDS = [
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'OUTER JOIN',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'LIMIT',
  'DISTINCT',
  'COUNT',
  'SUM',
  'AVG',
  'MAX',
  'MIN',
  'LIKE',
  'IN',
  'EXISTS',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'WHERE',
  'CASE',
  'ON',
  'BETWEEN',
];

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function extractSqlFromAgentOutput(output: string): string {
  return extractSqlFromText(output ?? '').trim();
}

export function normalizeSql(sql: string): string {
  return extractSqlFromAgentOutput(sql)
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/;+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function extractSelectColumns(sql: string): string[] {
  const normalized = extractSqlFromAgentOutput(sql).replace(/\s+/g, ' ').trim();
  const match = /^\s*(?:with\b[\s\S]+?\)\s*)?select\s+(.+?)\s+from\b/i.exec(
    normalized,
  );
  if (!match?.[1]) return [];

  const rawColumns = match[1]
    .split(',')
    .map((part) =>
      part
        .replace(/\bas\s+[a-z_][a-z0-9_]*$/i, '')
        .replace(/["'`]/g, '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  return dedupe(rawColumns);
}

export function extractSqlKeywords(sql: string): string[] {
  const upper = extractSqlFromAgentOutput(sql).toUpperCase();
  return SQL_KEYWORDS.filter((keyword) => upper.includes(keyword));
}

export function birdKeywordCoverage(generatedOutput: string, goldenSql: string): number {
  const goldenKeywords = extractSqlKeywords(goldenSql);
  if (goldenKeywords.length === 0) return 1;

  const agentKeywords = new Set(extractSqlKeywords(generatedOutput));
  const matched = goldenKeywords.filter((keyword) => agentKeywords.has(keyword)).length;
  return matched / goldenKeywords.length;
}

export function sqlTokenF1(generatedOutput: string, goldenSql: string): number {
  const tokenize = (sql: string): string[] =>
    normalizeSql(sql)
      .split(/[^a-z0-9_]+/i)
      .map((token) => token.trim())
      .filter(Boolean);

  const generatedTokens = tokenize(generatedOutput);
  const goldenTokens = tokenize(goldenSql);

  if (generatedTokens.length === 0 && goldenTokens.length === 0) return 1;
  if (generatedTokens.length === 0 || goldenTokens.length === 0) return 0;

  const generatedCounts = new Map<string, number>();
  for (const token of generatedTokens) {
    generatedCounts.set(token, (generatedCounts.get(token) ?? 0) + 1);
  }

  const goldenCounts = new Map<string, number>();
  for (const token of goldenTokens) {
    goldenCounts.set(token, (goldenCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  for (const [token, count] of generatedCounts) {
    overlap += Math.min(count, goldenCounts.get(token) ?? 0);
  }

  const precision = overlap / generatedTokens.length;
  const recall = overlap / goldenTokens.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}
