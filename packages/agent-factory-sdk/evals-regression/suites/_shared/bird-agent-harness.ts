/**
 * Bird benchmark agent harness.
 *
 * Unlike the regular ask-agent harness (which attaches the synthetic sales
 * datasource), this harness does three things:
 *
 *  1. Injects the schema for the specific BIRD database being tested
 *     (using real SQLite metadata when BIRD_SQLITE_ROOT is configured,
 *      with a stub fallback if real DB files are unavailable).
 *  2. Intercepts `runQuery` so the agent can generate SQL without executing it
 *     (BIRD tests SQL generation, not execution accuracy).
 *  3. Suppresses all tool calls that are irrelevant to SQL generation
 *     (chart, share, etc.).
 *
 * The db_id is passed in per-call so the harness can inject the right schema.
 */

import { convertToModelMessages, validateUIMessages } from 'ai';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { LLM } from '../../../src/llm/llm';
import { Provider } from '../../../src/llm/provider';
import { Registry } from '../../../src/tools/registry';
import { streamAgentResponse } from './stream-agent-response';
import { scopedConversationId } from './eval-project';

// ─── Stub schemas for each BIRD mini-dev database ────────────────────────────
//
// These are simplified versions of the real BIRD schemas — enough for the LLM
// to know which tables and key columns exist and generate plausible SQL.
// Full schemas would require downloading the SQLite files.

const BIRD_SCHEMAS: Record<string, { tables: Array<{ name: string; columns: Array<{ name: string; type: string }> }> }> = {
  california_schools: {
    tables: [
      { name: 'schools', columns: [{ name: 'CDSCode', type: 'text' }, { name: 'County', type: 'text' }, { name: 'District', type: 'text' }, { name: 'School', type: 'text' }, { name: 'City', type: 'text' }, { name: 'Zip', type: 'text' }, { name: 'Charter', type: 'number' }, { name: 'FundingType', type: 'text' }] },
      { name: 'satscores', columns: [{ name: 'cds', type: 'text' }, { name: 'rtype', type: 'text' }, { name: 'sname', type: 'text' }, { name: 'dname', type: 'text' }, { name: 'cname', type: 'text' }, { name: 'enroll12', type: 'number' }, { name: 'NumTstTakr', type: 'number' }, { name: 'AvgScrRead', type: 'number' }, { name: 'AvgScrMath', type: 'number' }, { name: 'AvgScrWrite', type: 'number' }, { name: 'PctGE1500', type: 'number' }] },
      { name: 'frpm', columns: [{ name: 'CDSCode', type: 'text' }, { name: 'County Name', type: 'text' }, { name: 'District Name', type: 'text' }, { name: 'School Name', type: 'text' }, { name: 'Academic Year', type: 'text' }, { name: 'Enrollment (K-12)', type: 'number' }, { name: 'Free Meal Count (K-12)', type: 'number' }, { name: 'Percent (%) Eligible Free (K-12)', type: 'number' }, { name: 'FRPM Count (K-12)', type: 'number' }] },
    ],
  },
  formula_1: {
    tables: [
      { name: 'races', columns: [{ name: 'raceId', type: 'number' }, { name: 'year', type: 'number' }, { name: 'round', type: 'number' }, { name: 'circuitId', type: 'number' }, { name: 'name', type: 'text' }, { name: 'date', type: 'date' }, { name: 'time', type: 'text' }, { name: 'url', type: 'text' }] },
      { name: 'drivers', columns: [{ name: 'driverId', type: 'number' }, { name: 'driverRef', type: 'text' }, { name: 'number', type: 'number' }, { name: 'code', type: 'text' }, { name: 'forename', type: 'text' }, { name: 'surname', type: 'text' }, { name: 'dob', type: 'date' }, { name: 'nationality', type: 'text' }, { name: 'url', type: 'text' }] },
      { name: 'circuits', columns: [{ name: 'circuitId', type: 'number' }, { name: 'circuitRef', type: 'text' }, { name: 'name', type: 'text' }, { name: 'location', type: 'text' }, { name: 'country', type: 'text' }, { name: 'lat', type: 'number' }, { name: 'lng', type: 'number' }, { name: 'alt', type: 'number' }, { name: 'url', type: 'text' }] },
      { name: 'constructors', columns: [{ name: 'constructorId', type: 'number' }, { name: 'constructorRef', type: 'text' }, { name: 'name', type: 'text' }, { name: 'nationality', type: 'text' }, { name: 'url', type: 'text' }] },
      { name: 'results', columns: [{ name: 'resultId', type: 'number' }, { name: 'raceId', type: 'number' }, { name: 'driverId', type: 'number' }, { name: 'constructorId', type: 'number' }, { name: 'number', type: 'number' }, { name: 'grid', type: 'number' }, { name: 'position', type: 'number' }, { name: 'positionText', type: 'text' }, { name: 'points', type: 'number' }, { name: 'laps', type: 'number' }, { name: 'time', type: 'text' }, { name: 'milliseconds', type: 'number' }, { name: 'fastestLap', type: 'number' }, { name: 'rank', type: 'number' }, { name: 'fastestLapTime', type: 'text' }, { name: 'fastestLapSpeed', type: 'text' }, { name: 'statusId', type: 'number' }] },
      { name: 'qualifying', columns: [{ name: 'qualifyId', type: 'number' }, { name: 'raceId', type: 'number' }, { name: 'driverId', type: 'number' }, { name: 'constructorId', type: 'number' }, { name: 'number', type: 'number' }, { name: 'position', type: 'number' }, { name: 'q1', type: 'text' }, { name: 'q2', type: 'text' }, { name: 'q3', type: 'text' }] },
      { name: 'lapTimes', columns: [{ name: 'raceId', type: 'number' }, { name: 'driverId', type: 'number' }, { name: 'lap', type: 'number' }, { name: 'position', type: 'number' }, { name: 'time', type: 'text' }, { name: 'milliseconds', type: 'number' }] },
      { name: 'pitStops', columns: [{ name: 'raceId', type: 'number' }, { name: 'driverId', type: 'number' }, { name: 'stop', type: 'number' }, { name: 'lap', type: 'number' }, { name: 'time', type: 'text' }, { name: 'duration', type: 'text' }, { name: 'milliseconds', type: 'number' }] },
      { name: 'seasons', columns: [{ name: 'year', type: 'number' }, { name: 'url', type: 'text' }] },
      { name: 'status', columns: [{ name: 'statusId', type: 'number' }, { name: 'status', type: 'text' }] },
      { name: 'driverStandings', columns: [{ name: 'driverStandingsId', type: 'number' }, { name: 'raceId', type: 'number' }, { name: 'driverId', type: 'number' }, { name: 'points', type: 'number' }, { name: 'position', type: 'number' }, { name: 'positionText', type: 'text' }, { name: 'wins', type: 'number' }] },
      { name: 'constructorResults', columns: [{ name: 'constructorResultsId', type: 'number' }, { name: 'raceId', type: 'number' }, { name: 'constructorId', type: 'number' }, { name: 'points', type: 'number' }, { name: 'status', type: 'text' }] },
      { name: 'constructorStandings', columns: [{ name: 'constructorStandingsId', type: 'number' }, { name: 'raceId', type: 'number' }, { name: 'constructorId', type: 'number' }, { name: 'points', type: 'number' }, { name: 'position', type: 'number' }, { name: 'positionText', type: 'text' }, { name: 'wins', type: 'number' }] },
    ],
  },
  card_games: {
    tables: [
      { name: 'cards', columns: [{ name: 'id', type: 'number' }, { name: 'name', type: 'text' }, { name: 'type', type: 'text' }, { name: 'subtypes', type: 'text' }, { name: 'colors', type: 'text' }, { name: 'manaCost', type: 'text' }, { name: 'convertedManaCost', type: 'number' }, { name: 'power', type: 'text' }, { name: 'toughness', type: 'text' }, { name: 'rarity', type: 'text' }, { name: 'artist', type: 'text' }, { name: 'setCode', type: 'text' }] },
      { name: 'sets', columns: [{ name: 'id', type: 'number' }, { name: 'code', type: 'text' }, { name: 'name', type: 'text' }, { name: 'type', type: 'text' }, { name: 'releaseDate', type: 'date' }, { name: 'totalSetSize', type: 'number' }] },
      { name: 'rulings', columns: [{ name: 'id', type: 'number' }, { name: 'uuid', type: 'text' }, { name: 'date', type: 'date' }, { name: 'text', type: 'text' }] },
    ],
  },
  financial: {
    tables: [
      { name: 'account', columns: [{ name: 'account_id', type: 'number' }, { name: 'district_id', type: 'number' }, { name: 'frequency', type: 'text' }, { name: 'date', type: 'date' }] },
      { name: 'client', columns: [{ name: 'client_id', type: 'number' }, { name: 'gender', type: 'text' }, { name: 'birth_date', type: 'date' }, { name: 'district_id', type: 'number' }] },
      { name: 'loan', columns: [{ name: 'loan_id', type: 'number' }, { name: 'account_id', type: 'number' }, { name: 'date', type: 'date' }, { name: 'amount', type: 'number' }, { name: 'duration', type: 'number' }, { name: 'payments', type: 'number' }, { name: 'status', type: 'text' }] },
      { name: 'trans', columns: [{ name: 'trans_id', type: 'number' }, { name: 'account_id', type: 'number' }, { name: 'date', type: 'date' }, { name: 'type', type: 'text' }, { name: 'operation', type: 'text' }, { name: 'amount', type: 'number' }, { name: 'balance', type: 'number' }] },
      { name: 'district', columns: [{ name: 'district_id', type: 'number' }, { name: 'A2', type: 'text' }, { name: 'A3', type: 'text' }, { name: 'A4', type: 'number' }, { name: 'A11', type: 'number' }, { name: 'A12', type: 'number' }, { name: 'A15', type: 'number' }] },
      { name: 'order', columns: [{ name: 'order_id', type: 'number' }, { name: 'account_id', type: 'number' }, { name: 'bank_to', type: 'text' }, { name: 'account_to', type: 'number' }, { name: 'amount', type: 'number' }, { name: 'k_symbol', type: 'text' }] },
    ],
  },
  student_club: {
    tables: [
      { name: 'member', columns: [{ name: 'member_id', type: 'text' }, { name: 'first_name', type: 'text' }, { name: 'last_name', type: 'text' }, { name: 'email', type: 'text' }, { name: 'position', type: 'text' }, { name: 't_shirt_size', type: 'text' }, { name: 'phone', type: 'text' }] },
      { name: 'event', columns: [{ name: 'event_id', type: 'text' }, { name: 'event_name', type: 'text' }, { name: 'event_date', type: 'date' }, { name: 'type', type: 'text' }, { name: 'notes', type: 'text' }, { name: 'location', type: 'text' }, { name: 'status', type: 'text' }] },
      { name: 'attendance', columns: [{ name: 'link_to_event', type: 'text' }, { name: 'link_to_member', type: 'text' }] },
      { name: 'expense', columns: [{ name: 'expense_id', type: 'text' }, { name: 'expense_description', type: 'text' }, { name: 'expense_date', type: 'date' }, { name: 'cost', type: 'number' }, { name: 'approved', type: 'number' }, { name: 'link_to_member', type: 'text' }, { name: 'link_to_budget', type: 'text' }] },
      { name: 'budget', columns: [{ name: 'budget_id', type: 'text' }, { name: 'category', type: 'text' }, { name: 'spent', type: 'number' }, { name: 'remaining', type: 'number' }, { name: 'amount', type: 'number' }, { name: 'event_status', type: 'text' }, { name: 'link_to_event', type: 'text' }] },
    ],
  },
  superhero: {
    tables: [
      { name: 'superhero', columns: [{ name: 'id', type: 'number' }, { name: 'superhero_name', type: 'text' }, { name: 'full_name', type: 'text' }, { name: 'gender_id', type: 'number' }, { name: 'eye_colour_id', type: 'number' }, { name: 'hair_colour_id', type: 'number' }, { name: 'skin_colour_id', type: 'number' }, { name: 'race_id', type: 'number' }, { name: 'publisher_id', type: 'number' }, { name: 'alignment_id', type: 'number' }, { name: 'height_cm', type: 'number' }, { name: 'weight_kg', type: 'number' }] },
      { name: 'hero_attribute', columns: [{ name: 'hero_id', type: 'number' }, { name: 'attribute_id', type: 'number' }, { name: 'attribute_value', type: 'number' }] },
      { name: 'attribute', columns: [{ name: 'id', type: 'number' }, { name: 'attribute_name', type: 'text' }] },
      { name: 'hero_power', columns: [{ name: 'hero_id', type: 'number' }, { name: 'power_id', type: 'number' }] },
      { name: 'superpower', columns: [{ name: 'id', type: 'number' }, { name: 'power_name', type: 'text' }] },
      { name: 'publisher', columns: [{ name: 'id', type: 'number' }, { name: 'publisher_name', type: 'text' }] },
      { name: 'gender', columns: [{ name: 'id', type: 'number' }, { name: 'gender', type: 'text' }] },
      { name: 'colour', columns: [{ name: 'id', type: 'number' }, { name: 'colour', type: 'text' }] },
      { name: 'race', columns: [{ name: 'id', type: 'number' }, { name: 'race', type: 'text' }] },
      { name: 'alignment', columns: [{ name: 'id', type: 'number' }, { name: 'alignment', type: 'text' }] },
    ],
  },
  // Generic fallback used for any db_id not explicitly listed above
  _fallback: {
    tables: [
      { name: 'main_table', columns: [{ name: 'id', type: 'number' }, { name: 'name', type: 'text' }, { name: 'value', type: 'number' }, { name: 'category', type: 'text' }, { name: 'date', type: 'date' }] },
    ],
  },
};

function getBirdSchema(dbId: string) {
  return BIRD_SCHEMAS[dbId] ?? BIRD_SCHEMAS['_fallback']!;
}

type BirdSchema = {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string }>;
  }>;
};

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

const SQLITE_CATALOG = 'bird_sqlite';

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveBirdSqlitePath(dbId: string): string | null {
  const root =
    process.env['BIRD_SQLITE_ROOT'] ??
    process.env['BIRD_DB_ROOT'] ??
    process.env['BIRD_DATASET_ROOT'];
  if (!root) return null;

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

  return candidates.find((path) => existsSync(path)) ?? null;
}

async function loadBirdSchemaFromSQLite(dbId: string): Promise<BirdSchema | null> {
  const sqlitePath = resolveBirdSqlitePath(dbId);
  if (!sqlitePath) return null;

  let instance: DuckDbInstance | null = null;
  let connection: DuckDbConnection | null = null;

  try {
    const dynamicImport = new Function(
      'modulePath',
      'return import(modulePath);',
    ) as (modulePath: string) => Promise<unknown>;
    const duckdb = (await dynamicImport('@duckdb/node-api')) as DuckDbModule;
    instance = await duckdb.DuckDBInstance.create(':memory:');
    connection = await instance.connect();

    try {
      await connection.run('INSTALL sqlite;');
    } catch {
      // sqlite extension may already be present.
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

    const tables: BirdSchema['tables'] = [];
    for (const row of tableRows) {
      if (typeof row.table_name !== 'string' || row.table_name.length === 0) continue;
      const tableName = row.table_name;
      const columnsResult = await connection.run(
        `SELECT column_name, data_type
           FROM information_schema.columns
          WHERE table_catalog = '${SQLITE_CATALOG}'
            AND table_schema = 'main'
            AND table_name = '${tableName.replace(/'/g, "''")}'
          ORDER BY ordinal_position`,
      );

      const columnRows = (await columnsResult.getRowObjectsJS()) as Array<{
        column_name?: unknown;
        data_type?: unknown;
      }>;

      tables.push({
        name: tableName,
        columns: columnRows
          .filter((column) => typeof column.column_name === 'string')
          .map((column) => ({
            name: column.column_name as string,
            type: typeof column.data_type === 'string' ? column.data_type : 'text',
          })),
      });
    }

    if (tables.length === 0) return null;
    return { tables };
  } catch {
    return null;
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

// ─── Harness ──────────────────────────────────────────────────────────────────

type BirdHarnessParams = {
  dbId: string;           // BIRD database domain (e.g. 'formula_1')
  question: string;       // The natural-language question
  model: string;
  conversationId?: string;
  messageId?: string;
};

const BIRD_DATASOURCE_ID = 'bird-benchmark-db';

export async function runBirdAgentHarness({
  dbId,
  question,
  model,
  conversationId,
  messageId,
}: BirdHarnessParams): Promise<string> {
  const abortController = new AbortController();
  const providerModel = Provider.getModelFromString(model);
  const modelForRegistry = {
    providerId: providerModel.providerID,
    modelId: providerModel.id,
  };
  const convId = conversationId ?? scopedConversationId(`bird-${dbId}`);
  const msgId = messageId ?? `bird-msg-${Math.random().toString(36).slice(2, 8)}`;

  const getContext = (options: { toolCallId?: string; abortSignal?: AbortSignal }) => ({
    conversationId: convId,
    agentId: 'ask',
    messageId: msgId,
    callId: options.toolCallId,
    abort: options.abortSignal ?? abortController.signal,
    extra: { attachedDatasources: [BIRD_DATASOURCE_ID] },
    messages: [],
    ask: async () => {},
    metadata: async () => {},
  });

  const { tools } = await Registry.tools.forAgent('ask', modelForRegistry, getContext);

  const schema = (await loadBirdSchemaFromSQLite(dbId)) ?? getBirdSchema(dbId);

  // Override getSchema → return the BIRD database stub schema
  if (tools.getSchema) {
    tools.getSchema = {
      ...tools.getSchema,
      execute: async () => ({
        schema,
        datasourceId: BIRD_DATASOURCE_ID,
      }),
    } as typeof tools.getSchema;
  }

  // Keep BIRD focused on SQL generation: expose schema inspection only.
  const sqlOnlyTools = Object.fromEntries(
    Object.entries(tools).filter(([id]) => id === 'getSchema'),
  );

  const messages = [
    {
      id: 'user-1',
      role: 'user' as const,
      parts: [{ type: 'text' as const, text: question }],
    },
  ];

  const validated = await validateUIMessages({ messages });
  const messagesForLlm = await convertToModelMessages(validated, { tools: sqlOnlyTools });

  return streamAgentResponse(
    async () =>
      (await LLM.stream({
        model,
        messages: messagesForLlm,
        system:
          `You are a SQL expert. Your task is to generate exactly one SQL query for the given question.\n` +
          `Database: ${dbId}\n` +
          `You may call getSchema once to inspect the available tables and columns.\n` +
          `Return ONLY the final SQL query that answers the question.\n` +
          `Do not explain your reasoning.\n` +
          `Do not include markdown, JSON, XML, tool traces, or any text before or after the SQL.\n` +
          `Do not retry or validate the query. Output a single SQL statement and stop.`,
        tools: sqlOnlyTools,
        abortSignal: abortController.signal,
      })) as unknown as {
        fullStream?: AsyncIterable<unknown>;
        text?: Promise<string> | string;
      },
  );
}
