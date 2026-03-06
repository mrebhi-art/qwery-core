import type { Dataset, DatasetId, DatasetExample } from '../../domain/evaluation';
import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';
import { DatasetNotFoundError } from '../evaluation-errors';

export type GetDatasetResult = {
  dataset: Dataset;
  examples: DatasetExample[];
};

export class GetDatasetUseCase {
  constructor(private readonly repository: DatasetRepository) {}

  async execute(id: DatasetId): Promise<GetDatasetResult> {
    const dataset = await this.repository.findDatasetById(id);
    if (!dataset) throw new DatasetNotFoundError(id);
    const examples = await this.repository.listExamples(id);
    return { dataset, examples };
  }
}
