import type {
  Dataset,
  DatasetId,
  DatasetExample,
  DatasetExampleId,
} from '../evaluation';

export interface DatasetRepository {
  saveDataset(dataset: Dataset): Promise<void>;
  findDatasetById(id: DatasetId): Promise<Dataset | null>;
  listDatasets(): Promise<Dataset[]>;
  saveExamples(examples: DatasetExample[]): Promise<void>;
  listExamples(datasetId: DatasetId): Promise<DatasetExample[]>;
  findExampleById(id: DatasetExampleId): Promise<DatasetExample | null>;
}
