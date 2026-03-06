import type { EvaluationResult, EvaluationRunId } from '../../domain/evaluation';
import type { EvaluationRepository } from '../../domain/ports/evaluation-repository.port';
import { EvaluationRunNotFoundError } from '../evaluation-errors';

export class ListEvaluationResultsUseCase {
  constructor(private readonly evalRepo: EvaluationRepository) {}

  async execute(runId: EvaluationRunId): Promise<EvaluationResult[]> {
    const run = await this.evalRepo.findRunById(runId);
    if (!run) throw new EvaluationRunNotFoundError(runId);
    return this.evalRepo.listResults(runId);
  }
}
