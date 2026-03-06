import { TracingSdk } from '@qwery/tracing-sdk';

let sdk: TracingSdk | undefined;

/**
 * Returns the TracingSdk singleton.
 * If TRACING_BASE_URL or TRACING_API_KEY are not set, returns null
 * — the app continues unaffected (fail silently by design).
 */
export function getTracingSdk(): TracingSdk | null {
  const baseUrl = process.env['TRACING_BASE_URL'];
  const apiKey = process.env['TRACING_API_KEY'];

  if (!baseUrl || !apiKey) return null;

  sdk ??= new TracingSdk({
    baseUrl,
    apiKey,
    failSilently: false,
    maxQueueSize: 50,
    flushIntervalMs: 2000,
    maxRetries: 3,
    retryBaseDelayMs: 200,
  });

  return sdk;
}

/** Gracefully drain the flush queue. Call on process shutdown. */
export async function shutdownTracing(): Promise<void> {
  await sdk?.shutdown();
}
