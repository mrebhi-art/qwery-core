import { randomUUID } from 'node:crypto';
import type { EnvConfig } from './types';

function isGoogleSheetUrl(value: string): boolean {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(value);
}

export function readEnv(): EnvConfig {
  const question =
    process.env['QUESTION'] ??
    process.env['QWERY_QUESTION'] ??
    'What tables are available in this datasource?';

  const model =
    process.env['MODEL'] ?? process.env['QWERY_MODEL'] ?? 'azure/gpt-5-nano';

  const agentId = process.env['AGENT_ID'] ?? process.env['QWERY_AGENT_ID'] ?? 'ask';
  const flowModeRaw =
    process.env['FLOW_MODE'] ?? process.env['QWERY_FLOW_MODE'] ?? 'compact';
  const flowMode = flowModeRaw === 'full' ? 'full' : 'compact';

  const datasourceId =
    process.env['DATASOURCE_ID'] ??
    process.env['QWERY_DATASOURCE_ID'] ??
    randomUUID();
  let datasourceName =
    process.env['DATASOURCE_NAME'] ??
    process.env['QWERY_DATASOURCE_NAME'] ??
    'eval-datasource';
  const rawDatasourceProvider =
    process.env['DATASOURCE_PROVIDER'] ?? process.env['QWERY_DATASOURCE_PROVIDER'];
  const providerWasExplicit =
    typeof rawDatasourceProvider === 'string' && rawDatasourceProvider.trim().length > 0;
  let datasourceProvider =
    rawDatasourceProvider && rawDatasourceProvider.trim().length > 0
      ? rawDatasourceProvider.trim()
      : 'duckdb';
  let datasourceDriver =
    process.env['DATASOURCE_DRIVER'] ??
    process.env['QWERY_DATASOURCE_DRIVER'] ??
    'node';
  let datasourceKind: 'embedded' | 'remote' =
    (process.env['DATASOURCE_KIND'] ??
      process.env['QWERY_DATASOURCE_KIND'] ??
      'embedded') === 'remote'
      ? 'remote'
      : 'embedded';

  const datasourceConfigJson =
    process.env['DATASOURCE_CONFIG_JSON'] ??
    process.env['QWERY_DATASOURCE_CONFIG_JSON'] ??
    '{}';

  let datasourceConfig: Record<string, unknown>;
  try {
    const parsed = JSON.parse(datasourceConfigJson) as unknown;
    datasourceConfig =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch (error) {
    throw new Error(
      `Invalid DATASOURCE_CONFIG_JSON/QWERY_DATASOURCE_CONFIG_JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const datasourceSharedLink =
    process.env['DATASOURCE_SHARED_LINK'] ??
    process.env['QWERY_DATASOURCE_SHARED_LINK'] ??
    process.env['DATASOURCE_SPREADSHEET_URL'] ??
    process.env['QWERY_DATASOURCE_SPREADSHEET_URL'] ??
    process.env['DATASOURCE_URL'] ??
    process.env['QWERY_DATASOURCE_URL'];

  if (
    typeof datasourceSharedLink === 'string' &&
    datasourceSharedLink.trim().length > 0
  ) {
    const normalizedLink = datasourceSharedLink.trim();

    // Auto-detect Google Sheets datasource settings from a pasted sheets URL.
    if (
      isGoogleSheetUrl(normalizedLink) &&
      (!providerWasExplicit || datasourceProvider === 'auto')
    ) {
      datasourceProvider = 'gsheet-csv';
      datasourceDriver = 'node';
      datasourceKind = 'remote';
      if (datasourceName === 'eval-datasource') {
        datasourceName = 'google-sheet-datasource';
      }
    }

    if (typeof datasourceConfig['sharedLink'] !== 'string') {
      datasourceConfig['sharedLink'] = normalizedLink;
    }
    if (typeof datasourceConfig['url'] !== 'string') {
      datasourceConfig['url'] = normalizedLink;
    }
  }

  const timeoutRaw = process.env['TIMEOUT_MS'] ?? process.env['QWERY_TIMEOUT_MS'] ?? '120000';
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid timeout value: ${timeoutRaw}`);
  }

  return {
    question,
    model,
    agentId,
    flowMode,
    datasourceId,
    datasourceName,
    datasourceProvider,
    datasourceDriver,
    datasourceKind,
    datasourceConfig,
    timeoutMs,
  };
}
