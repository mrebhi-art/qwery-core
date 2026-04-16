import type { FlowEvent } from './types';

export async function readSseEvents(
  body: ReadableStream<Uint8Array>,
): Promise<FlowEvent[]> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: FlowEvent[] = [];
  let buffer = '';
  let index = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitIndex = buffer.indexOf('\n\n');
    while (splitIndex !== -1) {
      const block = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);

      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'));
      for (const line of lines) {
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;

        let payload: unknown = raw;
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = raw;
        }

        events.push({ index: ++index, payload });
      }

      splitIndex = buffer.indexOf('\n\n');
    }
  }

  return events;
}

export function summarizeEventPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return String(payload);
  const p = payload as Record<string, unknown>;
  const type = typeof p.type === 'string' ? p.type : 'unknown';

  if (type === 'tool-input-available') {
    return `tool start: ${String(p.toolName ?? 'unknown')}`;
  }

  if (type === 'data-tool-execution' && p.data && typeof p.data === 'object') {
    const d = p.data as Record<string, unknown>;
    return `tool end: ${String(d.toolName ?? 'unknown')} (${String(d.executionTimeMs ?? '?')}ms)`;
  }

  if (type === 'text-delta') {
    const delta = typeof p.delta === 'string' ? p.delta : '';
    return `text delta: ${delta.slice(0, 80)}`;
  }

  return type;
}

export function summarizeToolParts(parts: unknown[]): Array<Record<string, unknown>> {
  const summary: Array<Record<string, unknown>> = [];

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    const type = p.type;
    if (typeof type !== 'string' || !type.startsWith('tool-')) continue;

    const output =
      p.output && typeof p.output === 'object'
        ? (p.output as Record<string, unknown>)
        : null;
    const result =
      output?.result && typeof output.result === 'object'
        ? (output.result as Record<string, unknown>)
        : null;
    const rows = Array.isArray(result?.rows) ? result.rows.length : undefined;

    summary.push({
      tool: type.replace('tool-', ''),
      state: p.state,
      query:
        p.input && typeof p.input === 'object'
          ? (p.input as Record<string, unknown>).query
          : undefined,
      errorText: p.errorText,
      rows,
      executionTimeMs: p.executionTimeMs,
    });
  }

  return summary;
}
