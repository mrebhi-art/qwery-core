import { computeAllMetrics, newEvaluationResultId } from '../../domain/evaluation';
import type { EvaluationRunId, EvaluationResult } from '../../domain/evaluation';
import type { DatasetRepository } from '../../domain/ports/dataset-repository.port';
import type { EvaluationRepository } from '../../domain/ports/evaluation-repository.port';
import type { AgentExecutorPort } from '../../domain/ports/agent-executor.port';
import { EvaluationRunNotFoundError } from '../evaluation-errors';
import { getLogger } from '@qwery/shared/logger';

export type ExecuteEvaluationRunResult = {
  runId: EvaluationRunId;
  total: number;
  completed: number;
  failed: number;
};

export class ExecuteEvaluationRunUseCase {
  constructor(
    private readonly datasetRepo: DatasetRepository,
    private readonly evalRepo: EvaluationRepository,
    private readonly agentExecutor: AgentExecutorPort,
  ) {}

  async execute(runId: EvaluationRunId): Promise<ExecuteEvaluationRunResult> {
    const logger = await getLogger();
    const run = await this.evalRepo.findRunById(runId);
    if (!run) throw new EvaluationRunNotFoundError(runId);

    await this.evalRepo.updateRunStatus(runId, 'running', { startedAt: new Date() });

    const examples = await this.datasetRepo.listExamples(run.datasetId);
    let completed = 0;
    let failed = 0;

    for (const example of examples) {
      try {
        const response = await this.agentExecutor.executeAgent(example.input, example.context);
        const metrics = computeAllMetrics({ goldenOutput: example.goldenOutput, agentOutput: response.output, config: run.metrics });

        const result: EvaluationResult = {
          id: newEvaluationResultId(),
          runId,
          exampleId: example.id,
          agentOutput: response.output,
          metrics,
          createdAt: new Date(),
        };
        await this.evalRepo.saveResult(result);
        completed++;
      } catch (err) {
        failed++;
        logger.warn({ exampleId: example.id, err }, '[eval] Example failed — skipping');
      }
    }

    await this.evalRepo.updateRunStatus(runId, 'completed', { completedAt: new Date() });
    return { runId, total: examples.length, completed, failed };
  }
}
