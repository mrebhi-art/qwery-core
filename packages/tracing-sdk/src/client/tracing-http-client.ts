import type {
  Trace,
  CreateTracePayload,
  AddStepPayload,
  CompleteTracePayload,
  FailTracePayload,
} from '../types';

export class TracingHttpClient {
  private readonly headers: HeadersInit;

  constructor(
    private readonly baseUrl: string,
    apiKey: string,
  ) {
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  async createTrace(payload: CreateTracePayload): Promise<Trace> {
    return this.post<Trace>('/traces', payload);
  }

  async addStep(traceId: string, payload: AddStepPayload): Promise<Trace> {
    return this.post<Trace>(`/traces/${traceId}/steps`, {
      ...payload,
      startedAt: payload.startedAt.toISOString(),
      endedAt: payload.endedAt.toISOString(),
    });
  }

  async completeTrace(
    traceId: string,
    payload: CompleteTracePayload,
  ): Promise<Trace> {
    return this.post<Trace>(`/traces/${traceId}/complete`, payload);
  }

  async failTrace(traceId: string, payload: FailTracePayload): Promise<Trace> {
    return this.post<Trace>(`/traces/${traceId}/fail`, payload);
  }

  async getTrace(traceId: string): Promise<Trace> {
    const res = await fetch(`${this.baseUrl}/traces/${traceId}`, {
      headers: this.headers,
    });
    return this.parseResponse<Trace>(res);
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: this.safeStringify(body),
    });
    return this.parseResponse<T>(res);
  }

  private safeStringify(body: unknown): string {
    try {
      return JSON.stringify(body, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        error: 'unserializable_payload',
        message,
      });
    }
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      throw new TracingClientError(res.status, text, res.url);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TracingClientError(res.status, `Invalid JSON: ${text}`, res.url);
    }
  }
}

export class TracingClientError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly url: string,
  ) {
    super(`[TracingClient] ${statusCode} ${url}: ${message}`);
    this.name = 'TracingClientError';
  }
}
