import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';
import type { Dataset, DatasetId, DatasetExample, DatasetExampleId } from '../../domain/evaluation';

export class InMemoryDatasetRepository implements DatasetRepository {
  private readonly datasets = new Map<string, Dataset>();
  private readonly examples = new Map<string, DatasetExample>();

  async saveDataset(dataset: Dataset): Promise<void> {
    this.datasets.set(dataset.id, dataset);
  }

  async findDatasetById(id: DatasetId): Promise<Dataset | null> {
    return this.datasets.get(id) ?? null;
  }

  async listDatasets(): Promise<Dataset[]> {
    return Array.from(this.datasets.values()).sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  async saveExamples(examples: DatasetExample[]): Promise<void> {
    for (const ex of examples) this.examples.set(ex.id, ex);
  }

  async listExamples(datasetId: DatasetId): Promise<DatasetExample[]> {
    return Array.from(this.examples.values()).filter((e) => e.datasetId === datasetId);
  }

  async findExampleById(id: DatasetExampleId): Promise<DatasetExample | null> {
    return this.examples.get(id) ?? null;
  }
}
