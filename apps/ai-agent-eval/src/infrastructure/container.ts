import postgres from 'postgres';
import { PostgresTraceRepository } from './persistence/postgres-trace.repository';
import { JsonFileTraceRepository } from './persistence/json-file-trace.repository';
import { PostgresDatasetRepository } from './persistence/postgres-dataset.repository';
import { JsonFileDatasetRepository } from './persistence/json-file-dataset.repository';
import { PostgresEvaluationRepository } from './persistence/postgres-evaluation.repository';
import { JsonFileEvaluationRepository } from './persistence/json-file-evaluation.repository';
import { getDataDir } from './persistence/json-file-store';
import { HttpAgentExecutorAdapter } from './adapters/http-agent-executor.adapter';
import {
  CreateTraceUseCase,
  AddStepUseCase,
  CompleteTraceUseCase,
  FailTraceUseCase,
  GetTraceUseCase,
  ListTracesUseCase,
  CreateDatasetUseCase,
  UploadExamplesUseCase,
  ListDatasetsUseCase,
  GetDatasetUseCase,
  StartEvaluationRunUseCase,
  ExecuteEvaluationRunUseCase,
  GetEvaluationRunUseCase,
  ListEvaluationRunsUseCase,
  ListEvaluationResultsUseCase,
  CreateDatasetFromTracesUseCase,
  EvaluateTracesDirectlyUseCase,
} from '../application';

// ─── Wire once, reuse everywhere ─────────────────────────────────────────────

let container: ReturnType<typeof buildContainer> | undefined;

function buildContainer() {
  const databaseUrl = process.env['DATABASE_URL'];
  const agentUrl = process.env['AGENT_URL'] ?? 'http://localhost:3000';

  const sql = databaseUrl ? postgres(databaseUrl) : undefined;

  const traceRepository = sql
    ? new PostgresTraceRepository(sql)
    : new JsonFileTraceRepository();

  const datasetRepository = sql
    ? new PostgresDatasetRepository(sql)
    : new JsonFileDatasetRepository();

  const evaluationRepository = sql
    ? new PostgresEvaluationRepository(sql)
    : new JsonFileEvaluationRepository();

  const agentExecutor = new HttpAgentExecutorAdapter(agentUrl);

  if (!databaseUrl) {
    console.warn(
      `[ai-agent-eval] DATABASE_URL not set — using JSON file store at: ${getDataDir()}`,
    );
  }

  return {
    useCases: {
      // ── Tracing ────────────────────────────────────────────────────────────
      createTrace: new CreateTraceUseCase(traceRepository),
      addStep: new AddStepUseCase(traceRepository),
      completeTrace: new CompleteTraceUseCase(traceRepository),
      failTrace: new FailTraceUseCase(traceRepository),
      getTrace: new GetTraceUseCase(traceRepository),
      listTraces: new ListTracesUseCase(traceRepository),
      // ── Evaluation ─────────────────────────────────────────────────────────
      createDatasetFromTraces: new CreateDatasetFromTracesUseCase(traceRepository, datasetRepository),
      evaluateTracesDirectly: new EvaluateTracesDirectlyUseCase(traceRepository),
      createDataset: new CreateDatasetUseCase(datasetRepository),
      uploadExamples: new UploadExamplesUseCase(datasetRepository),
      listDatasets: new ListDatasetsUseCase(datasetRepository),
      getDataset: new GetDatasetUseCase(datasetRepository),
      startEvaluationRun: new StartEvaluationRunUseCase(datasetRepository, evaluationRepository),
      executeEvaluationRun: new ExecuteEvaluationRunUseCase(datasetRepository, evaluationRepository, agentExecutor),
      getEvaluationRun: new GetEvaluationRunUseCase(evaluationRepository),
      listEvaluationRuns: new ListEvaluationRunsUseCase(evaluationRepository),
      listEvaluationResults: new ListEvaluationResultsUseCase(evaluationRepository),
    },
  };
}

export function getContainer() {
  container ??= buildContainer();
  return container;
}
