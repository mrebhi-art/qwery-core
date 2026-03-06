import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from './json-file-store';

// ─── Saved trace eval results ─────────────────────────────────────────────────
// Each trace gets its own file: data/trace-evals/<traceId>.json
// Stores the most recent eval result for that trace so you can revisit it.

export type SavedTraceEval = {
  traceId: string;
  savedAt: string; // ISO timestamp
  metrics: Array<{
    metric: string;
    category: string;
    score: number;
    passed: boolean;
    detail?: string;
  }>;
  score: number;
  passed: boolean;
  agentOutput: string;
  goldenOutput: string;
  inputPreview: string;
  error?: string;
};

function traceEvalDir(): string {
  return join(getDataDir(), 'trace-evals');
}

function evalFilePath(traceId: string): string {
  // Sanitize traceId so it's safe as a filename
  const safe = traceId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return join(traceEvalDir(), `${safe}.json`);
}

export async function saveTraceEval(result: SavedTraceEval): Promise<void> {
  const dir = traceEvalDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(evalFilePath(result.traceId), JSON.stringify({ ...result, savedAt: new Date().toISOString() }, null, 2), 'utf8');
}

export async function loadTraceEval(traceId: string): Promise<SavedTraceEval | null> {
  const path = evalFilePath(traceId);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as SavedTraceEval;
  } catch {
    return null;
  }
}
