import { timed } from '../core/trace-session';
import type { TraceSession } from '../core/trace-session';

/**
 * Wraps a tool function with automatic tracing.
 *
 * @example
 * const searchDb = tracedTool(originalSearchDb, session, { name: 'search_db' });
 * const result = await searchDb(query); // tool step recorded automatically
 */
export function tracedTool<TInput extends unknown[], TOutput>(
  toolFn: (...args: TInput) => Promise<TOutput>,
  session: TraceSession,
  options: {
    name: string;
    metadata?: Record<string, unknown>;
  },
): (...args: TInput) => Promise<TOutput> {
  return async (...args: TInput): Promise<TOutput> => {
    const { result, latencyMs, startedAt, endedAt } = await timed(() =>
      toolFn(...args),
    ).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      session.addToolStep({
        name: options.name,
        input: args,
        output: null,
        error: error.message,
        latencyMs: 0,
        startedAt: new Date(),
        endedAt: new Date(),
        metadata: options.metadata,
      });
      throw err;
    });

    session.addToolStep({
      name: options.name,
      input: args,
      output: result,
      latencyMs,
      startedAt,
      endedAt,
      metadata: options.metadata,
    });

    return result;
  };
}
