import type { TraceRepository } from '../../domain/ports/trace-repository.port';
import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';
import type { TraceId } from '../../domain/trace';
import { createDataset, createDatasetExample } from '../../domain/evaluation';
import type { Dataset, DatasetExample } from '../../domain/evaluation';
import type { DatasetId } from '../../domain/evaluation';
import { TraceNotFoundError } from '../errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TraceExampleCommand = {
  traceId: string;
  goldenOutput: string;
  metadata?: Record<string, string>;
};

export type CreateDatasetFromTracesCommand = {
  name: string;
  description?: string;
  apiKey: string;
  examples: TraceExampleCommand[];
};

export type CreateDatasetFromTracesResult = {
  dataset: Dataset;
  examples: DatasetExample[];
};

// ─── Use Case ─────────────────────────────────────────────────────────────────

export class CreateDatasetFromTracesUseCase {
  constructor(
    private readonly traceRepository: TraceRepository,
    private readonly datasetRepository: DatasetRepository,
  ) {}

  async execute(command: CreateDatasetFromTracesCommand): Promise<CreateDatasetFromTracesResult> {
    const dataset = createDataset({ name: command.name, description: command.description });
    await this.datasetRepository.saveDataset(dataset);

    const examples: DatasetExample[] = [];

    for (const ex of command.examples) {
      const trace = await this.traceRepository.findById(ex.traceId as TraceId, command.apiKey);
      if (!trace) throw new TraceNotFoundError(ex.traceId as TraceId);

      const inputStr =
        typeof trace.input === 'string'
          ? trace.input
          : JSON.stringify(trace.input);

      const example = createDatasetExample({
        datasetId: dataset.id as DatasetId,
        input: inputStr,
        context: String(trace.metadata['conversationSlug'] ?? trace.projectId),
        goldenOutput: ex.goldenOutput,
        metadata: {
          traceId: ex.traceId,
          agentVersion: trace.agentVersion,
          model: trace.modelName,
          ...(ex.metadata ?? {}),
        },
      });

      examples.push(example);
    }

    await this.datasetRepository.saveExamples(examples);

    return { dataset, examples };
  }
}
