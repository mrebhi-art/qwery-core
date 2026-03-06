import type { Dataset } from '../../domain/evaluation';
import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';

export class ListDatasetsUseCase {
  constructor(private readonly repository: DatasetRepository) {}

  async execute(): Promise<Dataset[]> {
    return this.repository.listDatasets();
  }
}
