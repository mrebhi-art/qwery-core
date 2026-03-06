import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const sql = postgres(process.env['DATABASE_URL'] ?? '');

const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');

await sql.unsafe(schema);

console.log('[tracing] Migration applied successfully.');
await sql.end();
