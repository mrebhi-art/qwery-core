const FALLBACK_PROJECT_ID = 'qwery-core';
const FALLBACK_DATASOURCE_ID = 'synthetic-eval-datasource';

function normalizeProjectId(raw: string | undefined): string {
  const normalized = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || FALLBACK_PROJECT_ID;
}

export const EVAL_PROJECT_ID = normalizeProjectId(process.env['EVAL_PROJECT_ID']);
const RAW_EVAL_DATASOURCE_ID = process.env['EVAL_DATASOURCE_ID']?.trim();
export const HAS_REAL_EVAL_DATASOURCE = Boolean(RAW_EVAL_DATASOURCE_ID);
export const EVAL_DATASOURCE_ID =
  RAW_EVAL_DATASOURCE_ID || FALLBACK_DATASOURCE_ID;

if (!process.env['EVAL_PROJECT_ID']) {
  process.env['EVAL_PROJECT_ID'] = EVAL_PROJECT_ID;
}
if (!process.env['EVAL_DATASOURCE_ID']) {
  process.env['EVAL_DATASOURCE_ID'] = EVAL_DATASOURCE_ID;
}
if (!process.env['AI_SDK_LOG_WARNINGS']) {
  process.env['AI_SDK_LOG_WARNINGS'] = 'false';
}

declare global {
  // AI SDK checks this flag on global scope.
  // eslint-disable-next-line no-var
  var AI_SDK_LOG_WARNINGS: boolean | undefined;
}

if (globalThis.AI_SDK_LOG_WARNINGS === undefined) {
  globalThis.AI_SDK_LOG_WARNINGS = false;
}

export function scopedConversationId(baseId: string): string {
  const base = baseId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = base || 'eval-session';
  const value = `${EVAL_PROJECT_ID}-${suffix}`;
  return value.length <= 120 ? value : value.slice(0, 120);
}
