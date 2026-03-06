import postgres from 'postgres';
import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';
import type { Dataset, DatasetId, DatasetExample, DatasetExampleId } from '../../domain/evaluation';

type DatasetRow = {
  id: string;
  name: string;
  description: string;
  created_at: Date;
  updated_at: Date;
};

type ExampleRow = {
  id: string;
  dataset_id: string;
  input: string;
  context: string | null;
  golden_output: string;
  metadata: Record<string, string>;
  created_at: Date;
};

function rowToDataset(row: DatasetRow): Dataset {
  return {
    id: row.id as DatasetId,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToExample(row: ExampleRow): DatasetExample {
  return {
    id: row.id as DatasetExampleId,
    datasetId: row.dataset_id as DatasetId,
    input: row.input,
    context: row.context,
    goldenOutput: row.golden_output,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

export class PostgresDatasetRepository implements DatasetRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async saveDataset(dataset: Dataset): Promise<void> {
    await this.sql`
      INSERT INTO eval_datasets (id, name, description, created_at, updated_at)
      VALUES (${dataset.id}, ${dataset.name}, ${dataset.description}, ${dataset.createdAt}, ${dataset.updatedAt})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = EXCLUDED.updated_at
    `;
  }

  async findDatasetById(id: DatasetId): Promise<Dataset | null> {
    const rows = await this.sql<DatasetRow[]>`
      SELECT * FROM eval_datasets WHERE id = ${id}
    `;
    return rows[0] ? rowToDataset(rows[0]) : null;
  }

  async listDatasets(): Promise<Dataset[]> {
    const rows = await this.sql<DatasetRow[]>`
      SELECT * FROM eval_datasets ORDER BY created_at DESC
    `;
    return rows.map(rowToDataset);
  }

  async saveExamples(examples: DatasetExample[]): Promise<void> {
    if (examples.length === 0) return;
    for (const ex of examples) {
      await this.sql`
        INSERT INTO eval_dataset_examples (id, dataset_id, input, context, golden_output, metadata, created_at)
        VALUES (${ex.id}, ${ex.datasetId}, ${ex.input}, ${ex.context ?? null}, ${ex.goldenOutput}, ${JSON.stringify(ex.metadata)}, ${ex.createdAt})
        ON CONFLICT (id) DO NOTHING
      `;
    }
  }

  async listExamples(datasetId: DatasetId): Promise<DatasetExample[]> {
    const rows = await this.sql<ExampleRow[]>`
      SELECT * FROM eval_dataset_examples WHERE dataset_id = ${datasetId} ORDER BY created_at ASC
    `;
    return rows.map(rowToExample);
  }

  async findExampleById(id: DatasetExampleId): Promise<DatasetExample | null> {
    const rows = await this.sql<ExampleRow[]>`
      SELECT * FROM eval_dataset_examples WHERE id = ${id}
    `;
    return rows[0] ? rowToExample(rows[0]) : null;
  }
}
