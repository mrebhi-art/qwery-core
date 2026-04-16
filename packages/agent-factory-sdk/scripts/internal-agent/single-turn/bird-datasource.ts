import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as duckdb from '@duckdb/node-api';

const SQLITE_CATALOG = 'bird_sqlite';

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function resolveBirdSqlitePath(dbId: string): string {
  const root =
    process.env['BIRD_SQLITE_ROOT'] ??
    process.env['BIRD_DB_ROOT'] ??
    process.env['BIRD_DATASET_ROOT'];

  if (!root) {
    throw new Error(
      'Missing BIRD_SQLITE_ROOT/BIRD_DB_ROOT/BIRD_DATASET_ROOT. Set one to the BIRD mini-dev root.',
    );
  }

  const resolvedRoot = resolve(root);
  const candidates = [
    resolve(resolvedRoot, dbId, `${dbId}.sqlite`),
    resolve(resolvedRoot, dbId, 'database.sqlite'),
    resolve(resolvedRoot, `${dbId}.sqlite`),
    resolve(resolvedRoot, 'database', dbId, `${dbId}.sqlite`),
    resolve(resolvedRoot, 'mini_dev_sqlite', dbId, `${dbId}.sqlite`),
    resolve(resolvedRoot, 'dev_databases', dbId, `${dbId}.sqlite`),
    resolve(resolvedRoot, 'train_databases', dbId, `${dbId}.sqlite`),
  ];

  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No SQLite file found for dbId="${dbId}" under ${resolvedRoot}.`,
    );
  }

  return found;
}

export async function buildDuckDbFromSQLite(
  sqlitePath: string,
  dbId: string,
): Promise<string> {
  const duckdbPath = resolve(
    process.cwd(),
    '.tmp',
    'internal-agent',
    'bird-single-turn',
    `${dbId}.duckdb`,
  );

  mkdirSync(dirname(duckdbPath), { recursive: true });

  if (existsSync(duckdbPath)) {
    rmSync(duckdbPath, { force: true });
  }
  const walPath = `${duckdbPath}.wal`;
  if (existsSync(walPath)) {
    rmSync(walPath, { force: true });
  }

  const instance = await duckdb.DuckDBInstance.create(duckdbPath);
  const connection = await instance.connect();

  try {
    try {
      await connection.run('INSTALL sqlite;');
    } catch {
      // sqlite extension may already be available.
    }
    await connection.run('LOAD sqlite;');

    await connection.run(
      `ATTACH '${sqlitePath.replace(/'/g, "''")}' AS ${quoteIdentifier(SQLITE_CATALOG)} (TYPE SQLITE);`,
    );

    const tablesResult = await connection.run(
      `SELECT table_name
         FROM information_schema.tables
        WHERE table_catalog = '${SQLITE_CATALOG}'
          AND table_schema = 'main'
        ORDER BY table_name`,
    );

    const tableRows = (await tablesResult.getRowObjectsJS()) as Array<{
      table_name?: unknown;
    }>;

    for (const row of tableRows) {
      if (typeof row.table_name !== 'string' || row.table_name.length === 0) {
        continue;
      }
      const tableName = row.table_name;
      await connection.run(
        `CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS
         SELECT *
           FROM ${quoteIdentifier(SQLITE_CATALOG)}.main.${quoteIdentifier(tableName)};`,
      );
    }
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  return duckdbPath;
}

export async function prepareBirdDatasource(dbId: string): Promise<{
  dbId: string;
  sqlitePath: string;
  duckdbPath: string;
  datasourceId: string;
  datasourceName: string;
  datasourceProvider: 'duckdb';
  datasourceDriver: string;
  datasourceKind: 'embedded';
  datasourceConfig: { database: string };
}> {
  const sqlitePath = resolveBirdSqlitePath(dbId);
  const duckdbPath = await buildDuckDbFromSQLite(sqlitePath, dbId);

  return {
    dbId,
    sqlitePath,
    duckdbPath,
    datasourceId: `bird-single-turn-${dbId}`,
    datasourceName: `bird-single-turn-${dbId}`,
    datasourceProvider: 'duckdb',
    datasourceDriver: 'duckdb.default',
    datasourceKind: 'embedded',
    datasourceConfig: { database: duckdbPath },
  };
}
