import { createDataset } from '../../domain/evaluation';
import type { Dataset } from '../../domain/evaluation';
import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';

export type CreateDatasetCommand = {
  name: string;
  description?: string;
};

export class CreateDatasetUseCase {
  constructor(private readonly repository: DatasetRepository) {}

  async execute(command: CreateDatasetCommand): Promise<Dataset> {
    const dataset = createDataset(command);
    await this.repository.saveDataset(dataset);
    return dataset;
  }
}
