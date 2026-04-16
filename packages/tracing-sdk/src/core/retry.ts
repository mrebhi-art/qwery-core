/**
 * Retry a promise-returning fn with exponential backoff.
 * Only retries on network errors (TypeError) or 5xx status codes.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry on 4xx (client errors — they won't self-heal)
      if (isClientError(err)) throw err;

      if (attempt < maxAttempts - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function isClientError(err: unknown): boolean {
  if (
    err instanceof Error &&
    err.name === 'TracingClientError' &&
    'statusCode' in err
  ) {
    const code = (err as { statusCode: number }).statusCode;
    return code >= 400 && code < 500;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
