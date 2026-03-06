import type { EvaluationRepository } from '../../domain/ports/evaluation-repository.port';
import type {
  EvaluationRun,
  EvaluationRunId,
  EvaluationResult,
  EvaluationRunStatus,
} from '../../domain/evaluation';
import { readCollection, writeCollection } from './json-file-store';

const RUNS_FILE = 'evaluation-runs.json';
const RESULTS_FILE = 'evaluation-results.json';

// ─── Date revival ─────────────────────────────────────────────────────────────

function reviveRun(raw: EvaluationRun): EvaluationRun {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt as unknown as string),
    startedAt: raw.startedAt ? new Date(raw.startedAt as unknown as string) : null,
    completedAt: raw.completedAt ? new Date(raw.completedAt as unknown as string) : null,
  };
}

function reviveResult(raw: EvaluationResult): EvaluationResult {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt as unknown as string),
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class JsonFileEvaluationRepository implements EvaluationRepository {
  async saveRun(run: EvaluationRun): Promise<void> {
    const all = await this.loadRuns();
    all.push(run);
    await writeCollection(RUNS_FILE, all);
  }

  async updateRun(run: EvaluationRun): Promise<void> {
    const all = await this.loadRuns();
    const idx = all.findIndex((r) => r.id === run.id);
    if (idx >= 0) {
      all[idx] = run;
    } else {
      all.push(run);
    }
    await writeCollection(RUNS_FILE, all);
  }

  async findRunById(id: EvaluationRunId): Promise<EvaluationRun | null> {
    const all = await this.loadRuns();
    return all.find((r) => r.id === id) ?? null;
  }

  async listRuns(datasetId?: string): Promise<EvaluationRun[]> {
    const all = await this.loadRuns();
    const sorted = all.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    return datasetId ? sorted.filter((r) => r.datasetId === datasetId) : sorted;
  }

  async saveResult(result: EvaluationResult): Promise<void> {
    const all = await this.loadResults();
    all.push(result);
    await writeCollection(RESULTS_FILE, all);
  }

  async listResults(runId: EvaluationRunId): Promise<EvaluationResult[]> {
    const all = await this.loadResults();
    return all.filter((r) => r.runId === runId);
  }

  async updateRunStatus(
    id: EvaluationRunId,
    status: EvaluationRunStatus,
    patch?: Partial<Pick<EvaluationRun, 'errorMessage' | 'startedAt' | 'completedAt'>>,
  ): Promise<void> {
    const all = await this.loadRuns();
    const idx = all.findIndex((r) => r.id === id);
    if (idx < 0) return;
    all[idx] = { ...all[idx]!, status, ...(patch ?? {}) };
    await writeCollection(RUNS_FILE, all);
  }

  private async loadRuns(): Promise<EvaluationRun[]> {
    const raw = await readCollection<EvaluationRun>(RUNS_FILE);
    return raw.map(reviveRun);
  }

  private async loadResults(): Promise<EvaluationResult[]> {
    const raw = await readCollection<EvaluationResult>(RESULTS_FILE);
    return raw.map(reviveResult);
  }
}
