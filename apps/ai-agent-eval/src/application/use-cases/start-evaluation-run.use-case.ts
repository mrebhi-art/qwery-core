import { createEvaluationRun } from '../../domain/evaluation';
import type { EvaluationRun, DatasetId, EvaluationMetricsConfig } from '../../domain/evaluation';
import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';
import type { EvaluationRepository } from '../../domain/ports/evaluation-repository.port';
import { DatasetNotFoundError } from '../evaluation-errors';

export type StartEvaluationRunCommand = {
  datasetId: DatasetId;
  agentVersion: string;
  agentUrl: string;
  metrics: Partial<EvaluationMetricsConfig>;
};

export class StartEvaluationRunUseCase {
  constructor(
    private readonly datasetRepo: DatasetRepository,
    private readonly evalRepo: EvaluationRepository,
  ) {}

  async execute(command: StartEvaluationRunCommand): Promise<EvaluationRun> {
    const dataset = await this.datasetRepo.findDatasetById(command.datasetId);
    if (!dataset) throw new DatasetNotFoundError(command.datasetId);

    const run = createEvaluationRun({
      datasetId: command.datasetId,
      agentVersion: command.agentVersion,
      agentUrl: command.agentUrl,
      metrics: command.metrics,
    });
    await this.evalRepo.saveRun(run);
    return run;
  }
}
