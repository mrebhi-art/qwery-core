import type { TraceRepository, ListTracesFilter } from '../../domain/ports/trace-repository.port';
import type { Trace, TraceId, TraceStep } from '../../domain/trace';
import { readCollection, writeCollection } from './json-file-store';

const FILE = 'traces.json';

// ─── Date revival ─────────────────────────────────────────────────────────────

function reviveStep(s: TraceStep): TraceStep {
  return {
    ...s,
    startedAt: new Date(s.startedAt as unknown as string),
    endedAt: new Date(s.endedAt as unknown as string),
  };
}

function reviveTrace(raw: Trace): Trace {
  return {
    ...raw,
    startedAt: new Date(raw.startedAt as unknown as string),
    endedAt: raw.endedAt ? new Date(raw.endedAt as unknown as string) : null,
    steps: raw.steps.map(reviveStep),
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class JsonFileTraceRepository implements TraceRepository {
  async save(trace: Trace): Promise<void> {
    const all = await this.loadAll();
    const idx = all.findIndex((t) => t.id === trace.id);
    if (idx >= 0) {
      all[idx] = trace;
    } else {
      all.push(trace);
    }
    await writeCollection(FILE, all);
  }

  async findById(id: TraceId, apiKey: string): Promise<Trace | null> {
    const all = await this.loadAll();
    const trace = all.find((t) => t.id === id && t.apiKey === apiKey);
    return trace ?? null;
  }

  async list(apiKey: string, filter?: ListTracesFilter): Promise<Trace[]> {
    let results = (await this.loadAll()).filter((t) => t.apiKey === apiKey);

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

  private async loadAll(): Promise<Trace[]> {
    const raw = await readCollection<Trace>(FILE);
    return raw.map(reviveTrace);
  }
}
