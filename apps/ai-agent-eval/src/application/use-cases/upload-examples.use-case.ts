import { createDatasetExample } from '../../domain/evaluation';
import type { DatasetExample, DatasetId } from '../../domain/evaluation';
import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';
import { DatasetNotFoundError } from '../evaluation-errors';

export type UploadExamplesCommand = {
  datasetId: DatasetId;
  examples: Array<{
    input: string;
    context?: string;
    goldenOutput: string;
    metadata?: Record<string, string>;
  }>;
};

export class UploadExamplesUseCase {
  constructor(private readonly repository: DatasetRepository) {}

  async execute(command: UploadExamplesCommand): Promise<DatasetExample[]> {
    const dataset = await this.repository.findDatasetById(command.datasetId);
    if (!dataset) throw new DatasetNotFoundError(command.datasetId);

    const examples = command.examples.map((raw) =>
      createDatasetExample({
        datasetId: command.datasetId,
        input: raw.input,
        context: raw.context,
        goldenOutput: raw.goldenOutput,
        metadata: raw.metadata,
      }),
    );
    await this.repository.saveExamples(examples);
    return examples;
  }
}
