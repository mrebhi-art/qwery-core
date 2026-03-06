import { timed } from '../core/trace-session';
import type { TraceSession } from '../core/trace-session';
import type { TokenUsage } from '../types';

/**
 * Wraps any LLM client callable with automatic tracing.
 *
 * @example
 * const llm = tracedLLM(originalLlm, session, {
 *   name: 'gpt-4o',
 *   extractTokenUsage: (res) => ({ promptTokens: res.usage.prompt_tokens, ... }),
 * });
 * const response = await llm(prompt); // traced automatically
 */
export function tracedLLM<TInput, TOutput>(
  llmFn: (input: TInput) => Promise<TOutput>,
  session: TraceSession,
  options: {
    name?: string;
    extractTokenUsage?: (output: TOutput) => TokenUsage | null;
    extractOutput?: (output: TOutput) => unknown;
    metadata?: Record<string, unknown>;
  } = {},
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput): Promise<TOutput> => {
    const { result, latencyMs, startedAt, endedAt } = await timed(() =>
      llmFn(input),
    ).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      session.addLlmStep({
        name: options.name ?? 'llm_call',
        input,
        output: null,
        error: error.message,
        latencyMs: 0,
        startedAt: new Date(),
        endedAt: new Date(),
        metadata: options.metadata,
      });
      throw err;
    });

    session.addLlmStep({
      name: options.name ?? 'llm_call',
      input,
      output: options.extractOutput ? options.extractOutput(result) : result,
      tokenUsage: options.extractTokenUsage?.(result) ?? null,
      latencyMs,
      startedAt,
      endedAt,
      metadata: options.metadata,
    });

    return result;
  };
}
