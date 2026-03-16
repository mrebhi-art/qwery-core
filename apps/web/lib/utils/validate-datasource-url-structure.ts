/**
 * Validates that a URL returns content matching the expected format (JSON, CSV, or Parquet).
 * Calls the server to fetch the URL and parse structure; prevents using a JSON URL in a CSV/Parquet datasource and vice versa.
 */

import { apiPost } from '../repositories/api-client';

export type DataUrlFormat = 'json' | 'csv' | 'parquet';

export interface ValidateUrlStructureResult {
  valid: boolean;
  error: string | null;
}

export async function validateUrlStructure(
  url: string,
  expectedFormat: DataUrlFormat,
): Promise<ValidateUrlStructureResult> {
  const trimmed = url?.trim();
  if (
    !trimmed ||
    (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))
  ) {
    return { valid: false, error: 'Please enter a valid URL (http or https)' };
  }

  try {
    const result = await apiPost<{ valid: boolean; error?: string }>(
      '/datasources/validate-url',
      { url: trimmed, expectedFormat },
      { timeout: 20_000 },
    );
    return {
      valid: result.valid === true,
      error: result.error ?? null,
    };
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'details' in err
        ? String((err as { details?: string }).details)
        : err instanceof Error
          ? err.message
          : 'Unable to verify URL format';
    return { valid: false, error: message };
  }
}
