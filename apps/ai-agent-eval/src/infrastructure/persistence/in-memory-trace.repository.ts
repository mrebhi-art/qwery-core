import type { TraceRepository, ListTracesFilter } from '../../domain/ports/trace-repository.port';
import type { Trace, TraceId } from '../../domain/trace';

/**
 * In-memory repository — used when DATABASE_URL is not set.
 * Useful for local development and testing without a Postgres instance.
 */
export class InMemoryTraceRepository implements TraceRepository {
  private readonly store = new Map<string, Trace>();

  async save(trace: Trace): Promise<void> {
    this.store.set(trace.id, trace);
  }

  async findById(id: TraceId, apiKey: string): Promise<Trace | null> {
    const trace = this.store.get(id);
    if (!trace || trace.apiKey !== apiKey) return null;
    return trace;
  }

  async list(apiKey: string, filter?: ListTracesFilter): Promise<Trace[]> {
    let results = [...this.store.values()].filter((t) => t.apiKey === apiKey);

    if (filter?.projectId) {
      results = results.filter((t) => t.projectId === filter.projectId);
    }
    if (filter?.status) {
      results = results.filter((t) => t.status === filter.status);
    }

    results.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 50;
    return results.slice(offset, offset + limit);
  }
}
