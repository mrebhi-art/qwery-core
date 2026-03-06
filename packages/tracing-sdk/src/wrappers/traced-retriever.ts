import { timed } from '../core/trace-session';
import type { TraceSession } from '../core/trace-session';

/**
 * Wraps a retriever function with automatic tracing.
 *
 * @example
 * const retrieve = tracedRetriever(vectorSearch, session, { name: 'vector_db' });
 * const docs = await retrieve(query); // retrieval step recorded automatically
 */
export function tracedRetriever<TInput extends unknown[], TOutput>(
  retrieverFn: (...args: TInput) => Promise<TOutput>,
  session: TraceSession,
  options: {
    name: string;
    metadata?: Record<string, unknown>;
  },
): (...args: TInput) => Promise<TOutput> {
  return async (...args: TInput): Promise<TOutput> => {
    const { result, latencyMs, startedAt, endedAt } = await timed(() =>
      retrieverFn(...args),
    ).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      session.addRetrievalStep({
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

    session.addRetrievalStep({
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
