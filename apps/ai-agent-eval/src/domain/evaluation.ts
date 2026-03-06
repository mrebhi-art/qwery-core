import { v4 as uuidv4 } from 'uuid';

// ─── Branded IDs ─────────────────────────────────────────────────────────────

export type DatasetId = string & { readonly __brand: 'DatasetId' };
export type DatasetExampleId = string & { readonly __brand: 'DatasetExampleId' };
export type EvaluationRunId = string & { readonly __brand: 'EvaluationRunId' };
export type EvaluationResultId = string & { readonly __brand: 'EvaluationResultId' };

export function newDatasetId(): DatasetId { return uuidv4() as DatasetId; }
export function newDatasetExampleId(): DatasetExampleId { return uuidv4() as DatasetExampleId; }
export function newEvaluationRunId(): EvaluationRunId { return uuidv4() as EvaluationRunId; }
export function newEvaluationResultId(): EvaluationResultId { return uuidv4() as EvaluationResultId; }

// ─── Metric Categories ────────────────────────────────────────────────────────

/**
 * SQL metrics — evaluate the generated SQL query against a golden query.
 *
 * sql_exact_match       — byte-for-byte equal after whitespace normalisation
 * sql_normalized_match  — case-insensitive, keyword-normalised comparison
 * sql_syntax_valid      — heuristic check that the output is valid SQL syntax
 * sql_columns_match     — SELECT-list columns match the golden query's columns
 */
export type SqlMetricName =
  | 'sql_exact_match'
  | 'sql_normalized_match'
  | 'sql_syntax_valid'
  | 'sql_columns_match';

export const SQL_METRICS: SqlMetricName[] = [
  'sql_exact_match',
  'sql_normalized_match',
  'sql_syntax_valid',
  'sql_columns_match',
];

/**
 * Chart metrics — evaluate an SVG / chart config output.
 *
 * chart_svg_valid       — output contains a well-formed <svg> element
 * chart_type_match      — the chart type (bar/line/pie/…) matches the golden
 * chart_svg_similarity  — compares data values, labels and mark count between generated and golden SVG
 * chart_data_present    — SVG contains data-carrying elements (rect/circle/path/polyline)
 */
export type ChartMetricName =
  | 'chart_svg_valid'
  | 'chart_type_match'
  | 'chart_svg_similarity'
  | 'chart_data_present';

export const CHART_METRICS: ChartMetricName[] = [
  'chart_svg_valid',
  'chart_type_match',
  'chart_svg_similarity',
  'chart_data_present',
];

/**
 * Tool metrics — evaluate whether the agent called the right tool(s).
 *
 * tool_called           — the expected tool name appears in the output
 * tool_args_exact       — tool arguments match the golden exactly (JSON equality)
 * tool_args_similarity  — fuzzy match of serialised tool arguments
 * tool_sequence_correct — tool call order matches golden sequence (JSON array)
 */
export type ToolMetricName =
  | 'tool_called'
  | 'tool_args_exact'
  | 'tool_args_similarity'
  | 'tool_sequence_correct';

export const TOOL_METRICS: ToolMetricName[] = [
  'tool_called',
  'tool_args_exact',
  'tool_args_similarity',
  'tool_sequence_correct',
];

/**
 * Overall metrics — generic output quality, not tied to a specific artifact type.
 *
 * exact_match           — exact string equality (normalised)
 * string_similarity     — Levenshtein-based similarity score (0–1)
 * pass_fail             — binary: passes if similarity >= threshold
 * json_exact_match      — deep structural JSON equality
 * contains_match        — golden output is contained within agent output
 */
export type OverallMetricName =
  | 'exact_match'
  | 'string_similarity'
  | 'pass_fail'
  | 'json_exact_match'
  | 'contains_match';

export const OVERALL_METRICS: OverallMetricName[] = [
  'exact_match',
  'string_similarity',
  'pass_fail',
  'json_exact_match',
  'contains_match',
];

// ─── Unified metric name + category ──────────────────────────────────────────

export type MetricCategory = 'sql' | 'chart' | 'tool' | 'overall';
export type MetricName = SqlMetricName | ChartMetricName | ToolMetricName | OverallMetricName;

/** Config object that declares which metrics to run, grouped by category. */
export type EvaluationMetricsConfig = {
  readonly sql: ReadonlyArray<SqlMetricName>;
  readonly chart: ReadonlyArray<ChartMetricName>;
  readonly tool: ReadonlyArray<ToolMetricName>;
  readonly overall: ReadonlyArray<OverallMetricName>;
};

export const EMPTY_METRICS_CONFIG: EvaluationMetricsConfig = {
  sql: [],
  chart: [],
  tool: [],
  overall: [],
};

export type EvaluationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export const PASS_THRESHOLD = 0.8;

// ─── Domain Entities ──────────────────────────────────────────────────────────

export type Dataset = {
  readonly id: DatasetId;
  readonly name: string;
  readonly description: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type DatasetExample = {
  readonly id: DatasetExampleId;
  readonly datasetId: DatasetId;
  readonly input: string;
  readonly context: string | null;
  readonly goldenOutput: string;
  readonly metadata: Record<string, string>;
  readonly createdAt: Date;
};

export type EvaluationRun = {
  readonly id: EvaluationRunId;
  readonly datasetId: DatasetId;
  readonly agentVersion: string;
  readonly agentUrl: string;
  readonly metrics: EvaluationMetricsConfig;
  readonly status: EvaluationRunStatus;
  readonly errorMessage: string | null;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
};

export type MetricResult = {
  readonly metric: MetricName;
  readonly category: MetricCategory;
  readonly score: number;        // 0–1
  readonly passed: boolean;
  readonly detail?: string;      // human-readable explanation
};

export type EvaluationResult = {
  readonly id: EvaluationResultId;
  readonly runId: EvaluationRunId;
  readonly exampleId: DatasetExampleId;
  readonly agentOutput: string;
  readonly metrics: MetricResult[];
  readonly createdAt: Date;
};

// ─── Factories ────────────────────────────────────────────────────────────────

export type CreateDatasetParams = {
  name: string;
  description?: string;
};

export function createDataset(params: CreateDatasetParams): Dataset {
  const now = new Date();
  return {
    id: newDatasetId(),
    name: params.name,
    description: params.description ?? '',
    createdAt: now,
    updatedAt: now,
  };
}

export type CreateDatasetExampleParams = {
  datasetId: DatasetId;
  input: string;
  context?: string;
  goldenOutput: string;
  metadata?: Record<string, string>;
};

export function createDatasetExample(params: CreateDatasetExampleParams): DatasetExample {
  return {
    id: newDatasetExampleId(),
    datasetId: params.datasetId,
    input: params.input,
    context: params.context ?? null,
    goldenOutput: params.goldenOutput,
    metadata: params.metadata ?? {},
    createdAt: new Date(),
  };
}

export type CreateEvaluationRunParams = {
  datasetId: DatasetId;
  agentVersion: string;
  agentUrl: string;
  metrics: Partial<EvaluationMetricsConfig>;
};

export function createEvaluationRun(params: CreateEvaluationRunParams): EvaluationRun {
  return {
    id: newEvaluationRunId(),
    datasetId: params.datasetId,
    agentVersion: params.agentVersion,
    agentUrl: params.agentUrl,
    metrics: {
      sql: params.metrics.sql ?? [],
      chart: params.metrics.chart ?? [],
      tool: params.metrics.tool ?? [],
      overall: params.metrics.overall ?? [],
    },
    status: 'pending',
    errorMessage: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object).sort();
    const bKeys = Object.keys(b as object).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

// ─── SQL metric computation ───────────────────────────────────────────────────

function normaliseSql(sql: string): string {
  return sql
    .trim()
    .replace(/--[^\n]*/g, '')        // strip single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments
    .trim()
    .replace(/;+\s*$/, '')           // strip trailing semicolons
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*=\s*/g, ' = ')
    .trim();
}

function extractSelectColumns(sql: string): string[] {
  const match = /select\s+(.*?)\s+from/i.exec(sql);
  if (!match) return [];
  return match[1]!
    .split(',')
    .map((c) => c.trim().toLowerCase().replace(/.*\s+as\s+/i, '').trim());
}

function isSqlSyntaxValid(sql: string): boolean {
  const s = sql.trim().toLowerCase();
  const startsWithKeyword = /^(select|insert|update|delete|with|create|drop|alter)\b/.test(s);
  if (!startsWithKeyword) return false;
  const opens = (s.match(/\(/g) ?? []).length;
  const closes = (s.match(/\)/g) ?? []).length;
  return opens === closes;
}

export function computeSqlMetrics(
  goldenSql: string,
  agentSql: string,
  metrics: ReadonlyArray<SqlMetricName>,
): MetricResult[] {
  return metrics.map((metric): MetricResult => {
    switch (metric) {
      case 'sql_exact_match': {
        const score = normalise(goldenSql) === normalise(agentSql) ? 1 : 0;
        return { metric, category: 'sql', score, passed: score === 1 };
      }
      case 'sql_normalized_match': {
        const score = normaliseSql(goldenSql) === normaliseSql(agentSql) ? 1 : 0;
        return { metric, category: 'sql', score, passed: score === 1 };
      }
      case 'sql_syntax_valid': {
        const passed = isSqlSyntaxValid(agentSql);
        return { metric, category: 'sql', score: passed ? 1 : 0, passed };
      }
      case 'sql_columns_match': {
        const goldenCols = extractSelectColumns(goldenSql).sort();
        const agentCols = extractSelectColumns(agentSql).sort();
        const matched = goldenCols.filter((c, i) => c === agentCols[i]).length;
        const total = Math.max(goldenCols.length, 1);
        const score = matched / total;
        return {
          metric,
          category: 'sql',
          score,
          passed: score >= PASS_THRESHOLD,
          detail: `golden: [${goldenCols.join(', ')}] | agent: [${agentCols.join(', ')}]`,
        };
      }
    }
  });
}

// ─── Chart metric computation ─────────────────────────────────────────────────

const CHART_TYPES = ['bar', 'line', 'pie', 'donut', 'scatter', 'area', 'histogram', 'heatmap'];

/**
 * Extract all numeric data values from an SVG.
 * Sources (in priority order):
 *  1. data-value / data-percent / data-count attributes
 *  2. Percentage text nodes: "45%", "45.3 %"
 *  3. Plain numbers inside <text> elements
 *  4. Arc sweep angles from pie/donut <path d="…"> (A command large-arc + sweep)
 */
function extractSvgDataValues(svg: string): number[] {
  const values: number[] = [];

  // 1. data-value / data-percent / data-count attributes
  const attrRe = /data-(?:value|percent|count)="([\d.]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(svg)) !== null) {
    values.push(parseFloat(m[1]!));
  }

  if (values.length > 0) return values.sort((a, b) => a - b);

  // 2. Percentage strings inside text/tspan elements
  const pctRe = />(\s*[\d.]+\s*%\s*)</g;
  while ((m = pctRe.exec(svg)) !== null) {
    values.push(parseFloat(m[1]!));
  }

  if (values.length > 0) return values.sort((a, b) => a - b);

  // 3. Plain numbers inside <text> or <tspan>
  const textRe = /<(?:text|tspan)[^>]*>\s*([\d.]+)\s*<\/(?:text|tspan)>/gi;
  while ((m = textRe.exec(svg)) !== null) {
    const v = parseFloat(m[1]!);
    if (!isNaN(v)) values.push(v);
  }

  if (values.length > 0) return values.sort((a, b) => a - b);

  // 4. Arc sweep angles from pie/donut paths  (A rx ry x-rot large-arc sweep ex ey)
  const arcRe = /[Aa][^A-Za-z]+?[01]\s+([01])\s+([\d.-]+)\s+([\d.-]+)/g;
  while ((m = arcRe.exec(svg)) !== null) {
    // approximate angle from end-point; just collect ex values as a fingerprint
    const ex = parseFloat(m[2]!);
    if (!isNaN(ex)) values.push(Math.abs(ex));
  }

  return values.sort((a, b) => a - b);
}

/**
 * Extract non-numeric text labels from <text>/<tspan> elements (skip pure numbers & percentages).
 */
function extractSvgLabels(svg: string): string[] {
  const labels: string[] = [];
  const re = /<(?:text|tspan)[^>]*>([^<]+)<\/(?:text|tspan)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const t = m[1]!.trim();
    if (t && !/^[\d.\s%]+$/.test(t)) labels.push(t.toLowerCase());
  }
  return labels.sort();
}

/** Mean absolute percentage difference between two sorted value arrays (0 = identical, 1 = completely different). */
function compareValueArrays(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Align by length — pad shorter array with 0
  const len = Math.max(a.length, b.length);
  const pa = [...a, ...Array(len - a.length).fill(0)] as number[];
  const pb = [...b, ...Array(len - b.length).fill(0)] as number[];

  let diff = 0;
  for (let i = 0; i < len; i++) {
    const denom = Math.max(pa[i]!, pb[i]!, 1);
    diff += Math.abs(pa[i]! - pb[i]!) / denom;
  }
  return Math.max(0, 1 - diff / len);
}

function extractChartType(svg: string): string | null {
  const lower = svg.toLowerCase();
  return CHART_TYPES.find((t) => lower.includes(`chart-type="${t}"`) || lower.includes(`data-type="${t}"`) || lower.includes(`class="${t}"`)) ?? null;
}

export function computeChartMetrics(
  goldenSvg: string,
  agentSvg: string,
  metrics: ReadonlyArray<ChartMetricName>,
): MetricResult[] {
  return metrics.map((metric): MetricResult => {
    switch (metric) {
      case 'chart_svg_valid': {
        const passed = /<svg[\s>]/i.test(agentSvg) && /<\/svg>/i.test(agentSvg);
        return { metric, category: 'chart', score: passed ? 1 : 0, passed };
      }
      case 'chart_type_match': {
        const goldenType = extractChartType(goldenSvg);
        const agentType = extractChartType(agentSvg);
        const passed = goldenType !== null && goldenType === agentType;
        return {
          metric,
          category: 'chart',
          score: passed ? 1 : 0,
          passed,
          detail: `golden: ${goldenType ?? 'unknown'} | agent: ${agentType ?? 'unknown'}`,
        };
      }
      case 'chart_svg_similarity': {
        // 1. Data values match (50%) — percentages/numbers that encode the actual chart data
        const goldenValues = extractSvgDataValues(goldenSvg);
        const agentValues  = extractSvgDataValues(agentSvg);
        const valueScore   = compareValueArrays(goldenValues, agentValues);

        // 2. Label text match (30%) — category/column labels in <text> elements
        const goldenLabels = extractSvgLabels(goldenSvg);
        const agentLabels  = extractSvgLabels(agentSvg);
        const allLabels    = new Set([...goldenLabels, ...agentLabels]);
        const labelScore   = allLabels.size === 0
          ? 1
          : [...allLabels].filter((l) => goldenLabels.includes(l) && agentLabels.includes(l)).length / allLabels.size;

        // 3. Data-element count match (20%) — same number of visual marks (slices/bars)
        const goldenMarks = (goldenSvg.match(/<(rect|circle|path|polygon)\b/gi) ?? []).length;
        const agentMarks  = (agentSvg.match(/<(rect|circle|path|polygon)\b/gi) ?? []).length;
        const markScore   = goldenMarks === 0 && agentMarks === 0
          ? 1
          : Math.min(goldenMarks, agentMarks) / Math.max(goldenMarks, agentMarks, 1);

        const score  = valueScore * 0.5 + labelScore * 0.3 + markScore * 0.2;
        const passed = score >= PASS_THRESHOLD;

        const missingLabels = goldenLabels.filter((l) => !agentLabels.includes(l));
        const extraLabels   = agentLabels.filter((l) => !goldenLabels.includes(l));

        const parts = [
          `values: golden=[${goldenValues.join(', ')}] agent=[${agentValues.join(', ')}] (${(valueScore * 100).toFixed(1)}%)`,
          `labels: ${(labelScore * 100).toFixed(1)}%${missingLabels.length ? ` | missing: ${missingLabels.join(', ')}` : ''}${extraLabels.length ? ` | extra: ${extraLabels.join(', ')}` : ''}`,
          `marks: golden=${goldenMarks} agent=${agentMarks}`,
          `combined: ${(score * 100).toFixed(1)}%`,
        ];

        return { metric, category: 'chart', score, passed, detail: parts.join(' | ') };
      }
      case 'chart_data_present': {
        // At this point agentSvg is always a real SVG artifact (use-case ensures it).
        // Count elements that carry data: colored fills, meaningful paths, data lines.
        const DATA_TAG_RE = /<(rect|circle|ellipse|path|polyline|polygon)\b([^>]*?)(?:\s*\/?>)/gi;

        function fillColor(attrs: string): string {
          const s = /style\s*=\s*["'][^"']*\bfill\s*:\s*([^;}"'\s]+)/i.exec(attrs)?.[1] ?? '';
          if (s) return s.toLowerCase();
          return (/\bfill\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '').toLowerCase();
        }

        function hexBrightness(color: string): number | null {
          const c = color.replace(/\s/g, '');
          if (/^#[0-9a-f]{3}$/i.test(c))
            return 0.299 * parseInt(c[1]! + c[1]!, 16) + 0.587 * parseInt(c[2]! + c[2]!, 16) + 0.114 * parseInt(c[3]! + c[3]!, 16);
          if (/^#[0-9a-f]{6}/i.test(c))
            return 0.299 * parseInt(c.slice(1, 3), 16) + 0.587 * parseInt(c.slice(3, 5), 16) + 0.114 * parseInt(c.slice(5, 7), 16);
          const rgb = /^rgba?\((\d+),(\d+),(\d+)/i.exec(c);
          if (rgb) return 0.299 * +rgb[1]! + 0.587 * +rgb[2]! + 0.114 * +rgb[3]!;
          return null;
        }

        const NEAR_WHITE = new Set(['none', 'transparent', 'white', 'whitesmoke']);

        let dataCount = 0;
        for (const m of agentSvg.matchAll(DATA_TAG_RE)) {
          const tag = m[1]!.toLowerCase();
          const attrs = m[2] ?? '';
          const fill = fillColor(attrs);

          if (NEAR_WHITE.has(fill)) continue;
          if (fill) {
            const b = hexBrightness(fill);
            if (b !== null && b > 210) continue; // near-white hex/rgb
          } else {
            // No fill — only count if it has a non-grey stroke (data line)
            const stroke = (/\bstroke\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '').toLowerCase();
            if (!stroke || /^(none|#[0-9a-f]{3,6}|gr[ae]y|black|#[0-9a-f]{3})$/.test(stroke) &&
              (hexBrightness(stroke) ?? 0) < 80) continue;
          }

          if (tag === 'path' && !/\bd\s*=\s*["'][^"']{10,}["']/.test(attrs)) continue;
          if (tag === 'circle') {
            const r = parseFloat(/\br\s*=\s*["']?([\d.]+)/.exec(attrs)?.[1] ?? '0');
            if (r < 2) continue;
          }
          if (tag === 'rect') {
            const h = parseFloat(/\bheight\s*=\s*["']?([\d.]+)/.exec(attrs)?.[1] ?? '0');
            const w = parseFloat(/\bwidth\s*=\s*["']?([\d.]+)/.exec(attrs)?.[1] ?? '0');
            if (h < 1 && w < 1) continue; // zero-sized rect carries no data
            if (h < 0.5 || w < 0.5) continue; // collapsed on one axis = invisible bar
          }

          dataCount++;
        }

        return { metric, category: 'chart', score: dataCount > 0 ? 1 : 0, passed: dataCount > 0, detail: `${dataCount} data element(s) found` };
      }
    }
  });
}

// ─── Tool metric computation ──────────────────────────────────────────────────

export function computeToolMetrics(
  goldenOutput: string,
  agentOutput: string,
  metrics: ReadonlyArray<ToolMetricName>,
): MetricResult[] {
  return metrics.map((metric): MetricResult => {
    switch (metric) {
      case 'tool_called': {
        // golden is the expected tool name; check it appears in agent output
        const toolName = normalise(goldenOutput);
        const passed = normalise(agentOutput).includes(toolName);
        return { metric, category: 'tool', score: passed ? 1 : 0, passed };
      }
      case 'tool_args_exact': {
        try {
          const goldenParsed = JSON.parse(goldenOutput) as unknown;
          const agentParsed = JSON.parse(agentOutput) as unknown;
          const passed = deepEqual(goldenParsed, agentParsed);
          return { metric, category: 'tool', score: passed ? 1 : 0, passed };
        } catch {
          const score = normalise(goldenOutput) === normalise(agentOutput) ? 1 : 0;
          return { metric, category: 'tool', score, passed: score === 1 };
        }
      }
      case 'tool_args_similarity': {
        const score = stringSimilarity(normalise(goldenOutput), normalise(agentOutput));
        return { metric, category: 'tool', score, passed: score >= PASS_THRESHOLD };
      }
      case 'tool_sequence_correct': {
        try {
          const golden = JSON.parse(goldenOutput) as string[];
          const agent = JSON.parse(agentOutput) as string[];
          if (!Array.isArray(golden) || !Array.isArray(agent)) {
            return { metric, category: 'tool', score: 0, passed: false, detail: 'not a JSON array' };
          }
          const matched = golden.filter((v, i) => v === agent[i]).length;
          const score = matched / Math.max(golden.length, 1);
          return { metric, category: 'tool', score, passed: score === 1 };
        } catch {
          return { metric, category: 'tool', score: 0, passed: false, detail: 'invalid JSON' };
        }
      }
    }
  });
}

// ─── Overall metric computation ───────────────────────────────────────────────

export function computeOverallMetrics(
  goldenOutput: string,
  agentOutput: string,
  metrics: ReadonlyArray<OverallMetricName>,
): MetricResult[] {
  const golden = normalise(goldenOutput);
  const actual = normalise(agentOutput);

  return metrics.map((metric): MetricResult => {
    switch (metric) {
      case 'exact_match': {
        const score = golden === actual ? 1 : 0;
        return { metric, category: 'overall', score, passed: score === 1 };
      }
      case 'string_similarity': {
        const score = stringSimilarity(golden, actual);
        return { metric, category: 'overall', score, passed: score >= PASS_THRESHOLD };
      }
      case 'pass_fail': {
        const sim = stringSimilarity(golden, actual);
        const passed = sim >= PASS_THRESHOLD;
        return { metric, category: 'overall', score: passed ? 1 : 0, passed };
      }
      case 'json_exact_match': {
        try {
          const passed = deepEqual(JSON.parse(goldenOutput) as unknown, JSON.parse(agentOutput) as unknown);
          return { metric, category: 'overall', score: passed ? 1 : 0, passed };
        } catch {
          return { metric, category: 'overall', score: 0, passed: false, detail: 'invalid JSON' };
        }
      }
      case 'contains_match': {
        const passed = actual.includes(golden);
        return { metric, category: 'overall', score: passed ? 1 : 0, passed };
      }
    }
  });
}

// ─── Unified compute (all categories) ────────────────────────────────────────

export type ComputeAllMetricsParams = {
  goldenOutput: string;
  agentOutput: string;
  config: EvaluationMetricsConfig;
};

export function computeAllMetrics(params: ComputeAllMetricsParams): MetricResult[] {
  const { goldenOutput, agentOutput, config } = params;
  return [
    ...computeSqlMetrics(goldenOutput, agentOutput, config.sql),
    ...computeChartMetrics(goldenOutput, agentOutput, config.chart),
    ...computeToolMetrics(goldenOutput, agentOutput, config.tool),
    ...computeOverallMetrics(goldenOutput, agentOutput, config.overall),
  ];
}

// ─── Legacy alias (keeps existing callers compiling) ─────────────────────────

/** @deprecated Use computeAllMetrics or the per-category functions instead. */
export function computeMetrics(
  goldenOutput: string,
  agentOutput: string,
  metrics: ReadonlyArray<OverallMetricName>,
): MetricResult[] {
  return computeOverallMetrics(goldenOutput, agentOutput, metrics);
}
