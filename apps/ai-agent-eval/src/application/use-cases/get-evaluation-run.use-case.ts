import type { EvaluationRun, EvaluationRunId } from '../../domain/evaluation';
import type { EvaluationRepository } from '../../domain/ports/evaluation-repository.port';
import { EvaluationRunNotFoundError } from '../evaluation-errors';

export class GetEvaluationRunUseCase {
  constructor(private readonly evalRepo: EvaluationRepository) {}

  async execute(id: EvaluationRunId): Promise<EvaluationRun> {
    const run = await this.evalRepo.findRunById(id);
    if (!run) throw new EvaluationRunNotFoundError(id);
    return run;
  }
}
