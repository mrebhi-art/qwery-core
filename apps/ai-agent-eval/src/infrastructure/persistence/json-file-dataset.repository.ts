import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';
import type { Dataset, DatasetId, DatasetExample, DatasetExampleId } from '../../domain/evaluation';
import { readCollection, writeCollection } from './json-file-store';

const DATASETS_FILE = 'datasets.json';
const EXAMPLES_FILE = 'examples.json';

// ─── Date revival ─────────────────────────────────────────────────────────────

function reviveDataset(raw: Dataset): Dataset {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt as unknown as string),
    updatedAt: new Date(raw.updatedAt as unknown as string),
  };
}

function reviveExample(raw: DatasetExample): DatasetExample {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt as unknown as string),
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class JsonFileDatasetRepository implements DatasetRepository {
  async saveDataset(dataset: Dataset): Promise<void> {
    const all = await this.loadDatasets();
    const idx = all.findIndex((d) => d.id === dataset.id);
    if (idx >= 0) {
      all[idx] = dataset;
    } else {
      all.push(dataset);
    }
    await writeCollection(DATASETS_FILE, all);
  }

  async findDatasetById(id: DatasetId): Promise<Dataset | null> {
    const all = await this.loadDatasets();
    return all.find((d) => d.id === id) ?? null;
  }

  async listDatasets(): Promise<Dataset[]> {
    const all = await this.loadDatasets();
    return all.sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  }

  async saveExamples(examples: DatasetExample[]): Promise<void> {
    const all = await this.loadExamples();
    for (const ex of examples) {
      const idx = all.findIndex((e) => e.id === ex.id);
      if (idx >= 0) {
        all[idx] = ex;
      } else {
        all.push(ex);
      }
    }
    await writeCollection(EXAMPLES_FILE, all);
  }

  async listExamples(datasetId: DatasetId): Promise<DatasetExample[]> {
    const all = await this.loadExamples();
    return all.filter((e) => e.datasetId === datasetId);
  }

  async findExampleById(id: DatasetExampleId): Promise<DatasetExample | null> {
    const all = await this.loadExamples();
    return all.find((e) => e.id === id) ?? null;
  }

  private async loadDatasets(): Promise<Dataset[]> {
    const raw = await readCollection<Dataset>(DATASETS_FILE);
    return raw.map(reviveDataset);
  }

  private async loadExamples(): Promise<DatasetExample[]> {
    const raw = await readCollection<DatasetExample>(EXAMPLES_FILE);
    return raw.map(reviveExample);
  }
}
