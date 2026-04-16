import type { BirdBenchmarkOptions, BirdDifficulty, BirdExample } from './types';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type DatasetServerRow = {
  row?: {
    db_id?: unknown;
    question?: unknown;
    SQL?: unknown;
    evidence?: unknown;
    difficulty?: unknown;
    question_id?: unknown;
  };
};

type DatasetServerResponse = {
  rows?: DatasetServerRow[];
  num_rows_total?: number;
};

type DatasetSplitsResponse = {
  splits?: Array<{
    dataset?: string;
    config?: string;
    split?: string;
  }>;
};

type LocalDatasetRow = {
  db_id?: unknown;
  question?: unknown;
  SQL?: unknown;
  evidence?: unknown;
  difficulty?: unknown;
  question_id?: unknown;
};

const HF_ROWS_URL = 'https://datasets-server.huggingface.co/rows';
const HF_SPLITS_URL = 'https://datasets-server.huggingface.co/splits';
const HF_DATASET = 'birdsql/bird_mini_dev';
const PAGE_SIZE = 100;

const CACHE_DIR = resolve(process.cwd(), 'evals-regression', 'reports', 'bird-cache');

function cachePath(key: string): string {
  return resolve(CACHE_DIR, `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`);
}

function readCache<T>(key: string): T | null {
  try {
    return JSON.parse(readFileSync(cachePath(key), 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  const path = cachePath(key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8');
}

function isBirdDifficulty(value: unknown): value is BirdDifficulty {
  return value === 'simple' || value === 'moderate' || value === 'challenging';
}

function splitDatasetFile(split: string): string | null {
  if (split === 'mini_dev_sqlite') return 'mini_dev_sqlite.json';
  if (split === 'mini_dev_mysql') return 'mini_dev_mysql.json';
  if (split === 'mini_dev_pg') return 'mini_dev_postgresql.json';
  return null;
}

function resolveLocalDatasetPath(split: string): string | null {
  const datasetFile = splitDatasetFile(split);
  if (!datasetFile) return null;

  const explicitFile = process.env['BIRD_DATASET_JSON'];
  if (explicitFile && existsSync(explicitFile)) {
    return explicitFile;
  }

  const datasetRoot =
    process.env['BIRD_DATASET_ROOT'] ??
    process.env['BIRD_SQLITE_ROOT'] ??
    process.env['BIRD_DB_ROOT'];

  const candidates: string[] = [];
  if (datasetRoot) {
    candidates.push(resolve(datasetRoot, datasetFile));
    candidates.push(resolve(datasetRoot, '..', datasetFile));
  }

  candidates.push(
    resolve(
      process.cwd(),
      'evals-regression',
      'data',
      'bird-mini-dev',
      'minidev',
      'minidev',
      'MINIDEV',
      datasetFile,
    ),
  );

  return candidates.find((path) => existsSync(path)) ?? null;
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit == null) return undefined;
  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  return Math.floor(limit);
}

function shouldRetry(status: number | undefined): boolean {
  return status === 408 || status === 429 || (status != null && status >= 500);
}

async function fetchPage(url: string, attempt = 0): Promise<DatasetServerResponse> {
  const key = `page-${url}`;
  const cached = readCache<DatasetServerResponse>(key);
  if (cached) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (attempt < 2 && shouldRetry(res.status)) {
        return fetchPage(url, attempt + 1);
      }
      throw new Error(`HuggingFace dataset server returned ${res.status}`);
    }
    const payload = (await res.json()) as DatasetServerResponse;
    writeCache(key, payload);
    return payload;
  } catch (error) {
    if (attempt < 2) {
      return fetchPage(url, attempt + 1);
    }
    throw new Error(
      `[BirdBenchmark] Failed to fetch BIRD examples: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function fetchSplits(attempt = 0): Promise<DatasetSplitsResponse> {
  const url = `${HF_SPLITS_URL}?dataset=${encodeURIComponent(HF_DATASET)}`;
  const cached = readCache<DatasetSplitsResponse>('splits');
  if (cached) return cached;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (attempt < 2 && shouldRetry(res.status)) {
        return fetchSplits(attempt + 1);
      }
      throw new Error(`HuggingFace dataset server returned ${res.status}`);
    }
    const payload = (await res.json()) as DatasetSplitsResponse;
    writeCache('splits', payload);
    return payload;
  } catch (error) {
    if (attempt < 2) {
      return fetchSplits(attempt + 1);
    }
    throw new Error(
      `[BirdBenchmark] Failed to resolve BIRD split metadata: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function resolveConfigForSplit(split: string): Promise<string> {
  const payload = await fetchSplits();
  const splits = Array.isArray(payload.splits) ? payload.splits : [];
  const exact = splits.find((entry) => entry.split === split && typeof entry.config === 'string');
  if (exact?.config) return exact.config;
  const configMatch = splits.find((entry) => entry.config === split && typeof entry.config === 'string');
  if (configMatch?.config) return configMatch.config;
  return split;
}

function parseRow(raw: DatasetServerRow): BirdExample | null {
  const row = raw.row;
  if (!row) return null;
  if (typeof row.db_id !== 'string') return null;
  if (typeof row.question !== 'string') return null;
  if (typeof row.SQL !== 'string') return null;
  if (!isBirdDifficulty(row.difficulty)) return null;

  const questionId =
    typeof row.question_id === 'number' || typeof row.question_id === 'string'
      ? String(row.question_id)
      : null;
  if (!questionId) return null;

  return {
    id: `${row.db_id}__${questionId}`,
    dbId: row.db_id,
    question: row.question,
    goldenSql: row.SQL,
    evidence: typeof row.evidence === 'string' ? row.evidence : '',
    difficulty: row.difficulty,
  };
}

function parseLocalRow(raw: LocalDatasetRow): BirdExample | null {
  if (typeof raw.db_id !== 'string') return null;
  if (typeof raw.question !== 'string') return null;
  if (typeof raw.SQL !== 'string') return null;
  if (!isBirdDifficulty(raw.difficulty)) return null;

  const questionId =
    typeof raw.question_id === 'number' || typeof raw.question_id === 'string'
      ? String(raw.question_id)
      : null;
  if (!questionId) return null;

  return {
    id: `${raw.db_id}__${questionId}`,
    dbId: raw.db_id,
    question: raw.question,
    goldenSql: raw.SQL,
    evidence: typeof raw.evidence === 'string' ? raw.evidence : '',
    difficulty: raw.difficulty,
  };
}

function loadBirdExamplesFromLocalFile(
  split: string,
  taskFilter: Set<string> | null,
  difficultyFilter: Set<BirdDifficulty> | null,
  limit: number | undefined,
): { examples: BirdExample[]; path: string } | null {
  const localPath = resolveLocalDatasetPath(split);
  if (!localPath) return null;

  try {
    const raw = JSON.parse(readFileSync(localPath, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return null;

    const examples: BirdExample[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const example = parseLocalRow(entry as LocalDatasetRow);
      if (!example) continue;
      if (taskFilter && !taskFilter.has(example.dbId)) continue;
      if (difficultyFilter && !difficultyFilter.has(example.difficulty)) continue;
      examples.push(example);
      if (limit != null && examples.length >= limit) break;
    }

    if (examples.length === 0) return null;
    return { examples, path: localPath };
  } catch {
    return null;
  }
}

export async function loadBirdExamples(
  options: BirdBenchmarkOptions = {},
): Promise<BirdExample[]> {
  const split = options.split ?? 'mini_dev_sqlite';
  const limit = normalizeLimit(options.limit);
  const taskFilter =
    options.tasks && options.tasks.length > 0 ? new Set(options.tasks) : null;
  const difficultyFilter =
    options.difficulty && options.difficulty.length > 0
      ? new Set(options.difficulty)
      : null;

  const preferLocalDataset = process.env['BIRD_PREFER_LOCAL_DATASET'] === '1';
  if (preferLocalDataset) {
    const local = loadBirdExamplesFromLocalFile(
      split,
      taskFilter,
      difficultyFilter,
      limit,
    );
    if (local) {
      return local.examples;
    }
  }

  let config: string;
  try {
    config = await resolveConfigForSplit(split);
  } catch (error) {
    const local = loadBirdExamplesFromLocalFile(
      split,
      taskFilter,
      difficultyFilter,
      limit,
    );
    if (local) {
      // eslint-disable-next-line no-console
      console.warn(
        `[BirdBenchmark] Falling back to local dataset file (${local.path}) because split metadata fetch failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return local.examples;
    }
    throw error;
  }

  const examples: BirdExample[] = [];
  let offset = 0;
  let totalRows: number | null = null;

  while (true) {
    if (limit != null && examples.length >= limit) break;
    if (totalRows != null && offset >= totalRows) break;

    const length =
      limit != null ? Math.min(PAGE_SIZE, limit - examples.length) : PAGE_SIZE;
    const url =
      `${HF_ROWS_URL}?dataset=${encodeURIComponent(HF_DATASET)}` +
      `&config=${encodeURIComponent(config)}` +
      `&split=${encodeURIComponent(split)}` +
      `&offset=${offset}` +
      `&length=${length}`;

    let page: DatasetServerResponse;
    try {
      page = await fetchPage(url);
    } catch (error) {
      const local = loadBirdExamplesFromLocalFile(
        split,
        taskFilter,
        difficultyFilter,
        limit,
      );
      if (local) {
        // eslint-disable-next-line no-console
        console.warn(
          `[BirdBenchmark] Falling back to local dataset file (${local.path}) because remote fetch failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return local.examples;
      }
      throw error;
    }
    const rows = Array.isArray(page.rows) ? page.rows : [];
    totalRows = typeof page.num_rows_total === 'number' ? page.num_rows_total : totalRows;

    if (rows.length === 0) break;

    for (const raw of rows) {
      const example = parseRow(raw);
      if (!example) continue;
      if (taskFilter && !taskFilter.has(example.dbId as never)) continue;
      if (difficultyFilter && !difficultyFilter.has(example.difficulty)) continue;
      examples.push(example);
      if (limit != null && examples.length >= limit) break;
    }

    offset += rows.length;
  }

  if (examples.length === 0) {
    throw new Error(
      `[BirdBenchmark] No BIRD examples matched the requested filters for split "${split}".`,
    );
  }

  return examples;
}
