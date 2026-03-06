import type {
  EvaluationRun,
  EvaluationRunId,
  EvaluationResult,
  EvaluationRunStatus,
} from '../evaluation';

export interface EvaluationRepository {
  saveRun(run: EvaluationRun): Promise<void>;
  updateRun(run: EvaluationRun): Promise<void>;
  findRunById(id: EvaluationRunId): Promise<EvaluationRun | null>;
  listRuns(datasetId?: string): Promise<EvaluationRun[]>;
  saveResult(result: EvaluationResult): Promise<void>;
  listResults(runId: EvaluationRunId): Promise<EvaluationResult[]>;
  updateRunStatus(
    id: EvaluationRunId,
    status: EvaluationRunStatus,
    patch?: Partial<Pick<EvaluationRun, 'errorMessage' | 'startedAt' | 'completedAt'>>,
  ): Promise<void>;
}
