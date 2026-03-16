export const JSON_PREVIEW_CONFIG = {
  MAX_JSON_SIZE: 5 * 1024 * 1024,
  MAX_DEPTH: 20,
  MAX_ITEMS_TO_RENDER: 100,
  MAX_STRING_LENGTH: 500,
} as const;

export interface JsonFetchResult {
  data: unknown;
  error: string | null;
}

function getApiBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env) {
    const url = process.env.VITE_API_URL ?? process.env.SERVER_API_URL ?? '';
    if (url) return url;
  }
  return (
    (
      import.meta as unknown as {
        env?: { VITE_API_URL?: string };
      }
    ).env?.VITE_API_URL ?? '/api'
  );
}

async function fetchJsonFromServer(url: string): Promise<JsonFetchResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/datasources/proxy-json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        data: null,
        error: body.error ?? `Server proxy failed (${res.status})`,
      };
    }
    const body = (await res.json()) as { data: unknown; error?: string };
    if (body.error) return { data: null, error: body.error };
    return { data: body.data, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Server proxy failed',
    };
  }
}

export async function fetchJsonData(
  url: string,
  signal?: AbortSignal,
): Promise<JsonFetchResult> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!response.ok) {
      return fetchJsonFromServer(url);
    }

    const contentLength = response.headers.get('content-length');
    if (
      contentLength &&
      parseInt(contentLength, 10) > JSON_PREVIEW_CONFIG.MAX_JSON_SIZE
    ) {
      return {
        data: null,
        error: `JSON file too large (${Math.round(parseInt(contentLength, 10) / 1024 / 1024)}MB). Max is ${JSON_PREVIEW_CONFIG.MAX_JSON_SIZE / 1024 / 1024}MB.`,
      };
    }

    const text = await response.text();
    if (text.length > JSON_PREVIEW_CONFIG.MAX_JSON_SIZE) {
      return {
        data: null,
        error: `JSON file too large (${Math.round(text.length / 1024 / 1024)}MB). Max is ${JSON_PREVIEW_CONFIG.MAX_JSON_SIZE / 1024 / 1024}MB.`,
      };
    }

    try {
      const parsed = JSON.parse(text);
      return { data: parsed, error: null };
    } catch {
      return fetchJsonFromServer(url);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { data: null, error: 'Request was aborted' };
    }
    return fetchJsonFromServer(url);
  }
}

export function formatJsonSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
