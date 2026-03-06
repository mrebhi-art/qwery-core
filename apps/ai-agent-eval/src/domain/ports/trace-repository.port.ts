import type { Trace, TraceId } from '../trace';

// ─── Repository Port (driven, secondary) ─────────────────────────────────────

export type ListTracesFilter = {
  projectId?: string;
  status?: 'running' | 'completed' | 'failed';
  limit?: number;
  offset?: number;
};

export interface TraceRepository {
  save(trace: Trace): Promise<void>;
  findById(id: TraceId, apiKey: string): Promise<Trace | null>;
  list(apiKey: string, filter?: ListTracesFilter): Promise<Trace[]>;
}
