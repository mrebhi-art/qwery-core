import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ─── JSON File Store ──────────────────────────────────────────────────────────
// Flat-file persistence layer. Each collection is stored as a JSON array in
// its own file under DATA_DIR (default: ./data).  Not designed for high
// concurrency — suitable for local development until Postgres is available.

export function getDataDir(): string {
  return process.env['DATA_DIR'] ?? join(process.cwd(), 'data');
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

export async function readCollection<T>(filename: string): Promise<T[]> {
  const dir = getDataDir();
  await ensureDir(dir);
  const filePath = join(dir, filename);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as T[];
}

export async function writeCollection<T>(filename: string, items: T[]): Promise<void> {
  const dir = getDataDir();
  await ensureDir(dir);
  const filePath = join(dir, filename);
  await writeFile(filePath, JSON.stringify(items, null, 2), 'utf8');
}
