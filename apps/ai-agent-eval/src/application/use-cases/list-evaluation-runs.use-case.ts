import type { EvaluationRun } from '../../domain/evaluation';
import type { EvaluationRepository } from '../../domain/ports/evaluation-repository.port';

export class ListEvaluationRunsUseCase {
  constructor(private readonly evalRepo: EvaluationRepository) {}

  async execute(datasetId?: string): Promise<EvaluationRun[]> {
    return this.evalRepo.listRuns(datasetId);
  }
}
