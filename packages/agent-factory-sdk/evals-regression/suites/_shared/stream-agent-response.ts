type StreamLike = {
  fullStream?: AsyncIterable<unknown>;
  text?: Promise<string> | string;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message && err.message.trim().length > 0
      ? err.message
      : err.name || 'Error';
  }
  return String(err);
}

function pickPartText(part: unknown): string {
  if (!part || typeof part !== 'object') return '';
  const p = part as Record<string, unknown>;
  const candidates = ['textDelta', 'text', 'outputText', 'delta'];
  for (const key of candidates) {
    const value = p[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function pickPartError(part: unknown): string | null {
  if (!part || typeof part !== 'object') return null;
  const p = part as Record<string, unknown>;
  const type = p['type'];
  if (type !== 'error') return null;
  const e = p['error'];
  if (e instanceof Error) return e.message || e.name || 'Stream error';
  if (e && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim().length > 0) return msg;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  if (typeof e === 'string' && e.trim().length > 0) return e;
  return 'Stream error';
}

function isRetryable(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('no output generated') ||
    m.includes('unable to connect') ||
    m.includes('connection refused') ||
    m.includes('econnreset') ||
    m.includes('econnrefused') ||
    m.includes('timed out') ||
    m.includes('timeout')
  );
}

async function readTextFromStream(result: StreamLike): Promise<string> {
  // Prefer AI SDK final assembled text when available.
  // It is typically cleaner than raw stream deltas.
  if (result.text !== undefined) {
    try {
      const text = await result.text;
      if (typeof text === 'string' && text.trim().length > 0) return text;
    } catch {
      // fall through to stream parsing for richer error capture
    }
  }

  let collectedText = '';
  let streamError: string | null = null;

  if (result.fullStream) {
    try {
      for await (const part of result.fullStream) {
        const text = pickPartText(part);
        if (text) collectedText += text;

        const err = pickPartError(part);
        if (err) streamError = err;
      }
    } catch (err) {
      streamError = normalizeError(err);
    }
  }

  const trimmed = collectedText.trim();
  if (trimmed.length > 0) return trimmed;

  // If the stream already reported a concrete upstream error, prefer it and
  // avoid calling result.text (which may throw a generic "No output generated").
  if (streamError) {
    throw new Error(streamError);
  }

  throw new Error(streamError ?? 'No output generated from model stream.');
}

export async function streamAgentResponse(
  createStream: () => Promise<StreamLike>,
  options?: { maxAttempts?: number; retryDelayMs?: number },
): Promise<string> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
  const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 500);

  let lastError = 'Unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await createStream();
      return await readTextFromStream(result);
    } catch (err) {
      lastError = normalizeError(err);
      const canRetry = attempt < maxAttempts && isRetryable(lastError);
      if (!canRetry) break;
      await delay(retryDelayMs * attempt);
    }
  }

  throw new Error(lastError);
}
