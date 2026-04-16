import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as duckdb from '@duckdb/node-api';
import type { EnvConfig } from './types';

export async function ensureSeededDuckDb(config: EnvConfig): Promise<EnvConfig> {
  const skipSeed =
    process.env['QWERY_INTERNAL_SKIP_SEED'] === '1' ||
    process.env['INTERNAL_AGENT_SKIP_SEED'] === '1';
  if (skipSeed) {
    return config;
  }

  if (config.datasourceProvider !== 'duckdb' || config.datasourceKind !== 'embedded') {
    return config;
  }

  const existingDatabase = config.datasourceConfig['database'];
  const databasePath =
    typeof existingDatabase === 'string' && existingDatabase.trim().length > 0
      ? existingDatabase
      : join(process.cwd(), '.tmp', 'internal-agent', 'single-turn.duckdb');

  mkdirSync(dirname(databasePath), { recursive: true });

  const instance = await duckdb.DuckDBInstance.create(databasePath);
  const connection = await instance.connect();

  try {
    await connection.run(`
      CREATE OR REPLACE TABLE sales AS
      SELECT *
      FROM (
        VALUES
          ('2026-01', 54000),
          ('2026-02', 62000),
          ('2026-03', 71000),
          ('2026-04', 68000)
      ) AS t(month, revenue);
    `);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  return {
    ...config,
    datasourceConfig: {
      ...config.datasourceConfig,
      database: databasePath,
    },
  };
}

export async function buildFallbackAnswer(config: EnvConfig): Promise<string | null> {
  if (config.datasourceProvider !== 'duckdb') return null;
  const databasePath = config.datasourceConfig['database'];
  if (typeof databasePath !== 'string' || databasePath.trim().length === 0) {
    return null;
  }

  const instance = await duckdb.DuckDBInstance.create(databasePath);
  const connection = await instance.connect();
  try {
    const result = await connection.run(
      'SELECT month, SUM(revenue) AS total_revenue FROM sales GROUP BY month ORDER BY month',
    );
    const rows = (await result.getRowObjectsJS()) as Array<{
      month: string;
      total_revenue: number;
    }>;
    if (rows.length === 0) return 'No rows were found in sales.';

    const lines = rows.map((row) => `${row.month}: ${row.total_revenue}`);
    return `Total revenue by month:\n${lines.join('\n')}`;
  } catch {
    return null;
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
