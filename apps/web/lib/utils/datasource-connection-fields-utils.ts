import type { DatasourceFormConfigPayload } from '~/lib/utils/datasource-form-config';

export function getConnectionValueKey(
  connectionFieldKind: string,
  formConfig?: DatasourceFormConfigPayload | null,
): string {
  if (formConfig?.preset === 'embeddable') return 'database';
  switch (connectionFieldKind) {
    case 'apiKey':
      return 'apiKey';
    case 'sharedLink':
      return 'sharedLink';
    case 'fileUrl':
      return formConfig?.normalizedKey ?? 'url';
    default:
      return 'connectionUrl';
  }
}

const DEFAULT_KEYS = [
  'host',
  'port',
  'database',
  'username',
  'password',
  'connectionUrl',
  'sharedLink',
  'apiKey',
  'url',
  'jsonUrl',
] as const;

export function getDefaultConnectionValues(): Record<string, string> {
  return Object.fromEntries(DEFAULT_KEYS.map((k) => [k, '']));
}

export function asSubmitRecord(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined && v !== ''),
  );
}

export const DETAILS_KEYS = [
  'host',
  'port',
  'database',
  'schema',
  'username',
  'password',
] as const;
