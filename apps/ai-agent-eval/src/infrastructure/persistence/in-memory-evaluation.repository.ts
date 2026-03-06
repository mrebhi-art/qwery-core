import type { EvaluationRepository } from '../../domain/ports/evaluation-repository.port';
import type {
  EvaluationRun,
  EvaluationRunId,
  EvaluationResult,
  EvaluationRunStatus,
} from '../../domain/evaluation';

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private readonly runs = new Map<string, EvaluationRun>();
  private readonly results: EvaluationResult[] = [];

  async saveRun(run: EvaluationRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async updateRun(run: EvaluationRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async findRunById(id: EvaluationRunId): Promise<EvaluationRun | null> {
    return this.runs.get(id) ?? null;
  }

  async listRuns(datasetId?: string): Promise<EvaluationRun[]> {
    const all = Array.from(this.runs.values()).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    return datasetId ? all.filter((r) => r.datasetId === datasetId) : all;
  }

  async saveResult(result: EvaluationResult): Promise<void> {
    this.results.push(result);
  }

  async listResults(runId: EvaluationRunId): Promise<EvaluationResult[]> {
    return this.results.filter((r) => r.runId === runId);
  }

  async updateRunStatus(
    id: EvaluationRunId,
    status: EvaluationRunStatus,
    patch?: Partial<Pick<EvaluationRun, 'errorMessage' | 'startedAt' | 'completedAt'>>,
  ): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return;
    this.runs.set(id, { ...run, status, ...(patch ?? {}) });
  }
}
