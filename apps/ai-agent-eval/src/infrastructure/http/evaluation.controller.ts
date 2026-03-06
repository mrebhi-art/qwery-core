import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { CreateDatasetUseCase } from '../../application/use-cases/create-dataset.use-case';
import type { UploadExamplesUseCase } from '../../application/use-cases/upload-examples.use-case';
import type { ListDatasetsUseCase } from '../../application/use-cases/list-datasets.use-case';
import type { GetDatasetUseCase } from '../../application/use-cases/get-dataset.use-case';
import type { StartEvaluationRunUseCase } from '../../application/use-cases/start-evaluation-run.use-case';
import type { ExecuteEvaluationRunUseCase } from '../../application/use-cases/execute-evaluation-run.use-case';
import type { GetEvaluationRunUseCase } from '../../application/use-cases/get-evaluation-run.use-case';
import type { ListEvaluationRunsUseCase } from '../../application/use-cases/list-evaluation-runs.use-case';
import type { ListEvaluationResultsUseCase } from '../../application/use-cases/list-evaluation-results.use-case';
import type { DatasetId, EvaluationRunId } from '../../domain/evaluation';
import { DatasetNotFoundError, EvaluationRunNotFoundError } from '../../application/evaluation-errors';
import type { CreateDatasetFromTracesUseCase } from '../../application/use-cases/create-dataset-from-traces.use-case';
import type { EvaluateTracesDirectlyUseCase } from '../../application/use-cases/evaluate-traces-directly.use-case';
import { saveTraceEval, loadTraceEval } from '../persistence/trace-eval.store';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createDatasetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const exampleSchema = z.object({
  input: z.string().min(1),
  context: z.string().optional(),
  goldenOutput: z.string().min(1),
  metadata: z.record(z.string(), z.string()).optional(),
});

const uploadExamplesSchema = z.object({
  examples: z.array(exampleSchema).min(1),
});

const sqlMetricSchema = z.enum(['sql_exact_match', 'sql_normalized_match', 'sql_syntax_valid', 'sql_columns_match']);
const chartMetricSchema = z.enum(['chart_svg_valid', 'chart_type_match', 'chart_svg_similarity', 'chart_data_present']);
const toolMetricSchema = z.enum(['tool_called', 'tool_args_exact', 'tool_args_similarity', 'tool_sequence_correct']);
const overallMetricSchema = z.enum(['exact_match', 'string_similarity', 'pass_fail', 'json_exact_match', 'contains_match']);

const fromTracesExampleSchema = z.object({
  traceId: z.string().min(1),
  goldenOutput: z.string().min(1),
  metadata: z.record(z.string(), z.string()).optional(),
});

const evaluateTracesDirectlySchema = z.object({
  items: z.array(z.object({
    traceId: z.string().min(1),
    goldenOutput: z.string().optional(),
    goldenSql:    z.string().optional(),
    goldenChart:  z.string().optional(),
    goldenTool:   z.string().optional(),
  })).min(1),
  metrics: z
    .object({
      sql:     z.array(sqlMetricSchema).optional().default([]),
      chart:   z.array(chartMetricSchema).optional().default([]),
      tool:    z.array(toolMetricSchema).optional().default([]),
      overall: z.array(overallMetricSchema).optional().default([]),
    })
    .optional()
    .default({ sql: [], chart: [], tool: [], overall: ['string_similarity'] }),
});

const createDatasetFromTracesSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  examples: z.array(fromTracesExampleSchema).min(1),
});

const startRunSchema = z.object({
  datasetId: z.string().min(1),
  agentVersion: z.string().min(1),
  agentUrl: z.string().url(),
  metrics: z
    .object({
      sql:     z.array(sqlMetricSchema).optional().default([]),
      chart:   z.array(chartMetricSchema).optional().default([]),
      tool:    z.array(toolMetricSchema).optional().default([]),
      overall: z.array(overallMetricSchema).optional().default(['exact_match', 'string_similarity']),
    })
    .optional()
    .default({ sql: [], chart: [], tool: [], overall: ['exact_match', 'string_similarity'] }),
});

// ─── Controller factory ───────────────────────────────────────────────────────

type EvalUseCases = {
  createDatasetFromTraces: CreateDatasetFromTracesUseCase;
  evaluateTracesDirectly: EvaluateTracesDirectlyUseCase;
  createDataset: CreateDatasetUseCase;
  uploadExamples: UploadExamplesUseCase;
  listDatasets: ListDatasetsUseCase;
  getDataset: GetDatasetUseCase;
  startEvaluationRun: StartEvaluationRunUseCase;
  executeEvaluationRun: ExecuteEvaluationRunUseCase;
  getEvaluationRun: GetEvaluationRunUseCase;
  listEvaluationRuns: ListEvaluationRunsUseCase;
  listEvaluationResults: ListEvaluationResultsUseCase;
};

export function createEvaluationRoutes(useCases: EvalUseCases) {
  const app = new Hono();

  // ── Datasets ──────────────────────────────────────────────────────────────

  // ── Direct trace evaluation ───────────────────────────────────────────────

  app.post('/evaluate-traces', zValidator('json', evaluateTracesDirectlySchema), async (c) => {
    const body = c.req.valid('json');
    const apiKey = process.env['DASHBOARD_API_KEY'] ?? 'local-dev';
    try {
      const result = await useCases.evaluateTracesDirectly.execute({
        apiKey,
        items: body.items,
        metrics: body.metrics,
      });
      // Persist each result for later retrieval
      await Promise.all(
        result.results.map((r) =>
          saveTraceEval({
            traceId: r.traceId,
            savedAt: new Date().toISOString(),
            metrics: r.metrics,
            score: r.score,
            passed: r.passed,
            agentOutput: r.agentOutput,
            goldenOutput: r.goldenOutput,
            inputPreview: r.inputPreview,
            error: r.error,
          }).catch(() => { /* non-fatal */ }),
        ),
      );
      return c.json(result);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
    }
  });

  app.get('/traces/:traceId/eval', async (c) => {
    const traceId = c.req.param('traceId');
    const saved = await loadTraceEval(traceId);
    if (!saved) return c.json({ result: null });
    return c.json({ result: saved });
  });

  // ── From-traces dataset ───────────────────────────────────────────────────

  app.post('/datasets/from-traces', zValidator('json', createDatasetFromTracesSchema), async (c) => {
    const body = c.req.valid('json');
    const apiKey = process.env['DASHBOARD_API_KEY'] ?? 'local-dev';
    try {
      const result = await useCases.createDatasetFromTraces.execute({
        name: body.name,
        description: body.description,
        apiKey,
        examples: body.examples,
      });
      return c.json({ dataset: result.dataset, exampleCount: result.examples.length }, 201);
    } catch (err) {
      if (err instanceof DatasetNotFoundError) return c.json({ error: err.message }, 404);
      return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
    }
  });

  app.post('/datasets', zValidator('json', createDatasetSchema), async (c) => {
    const body = c.req.valid('json');
    const dataset = await useCases.createDataset.execute(body);
    return c.json(dataset, 201);
  });

  app.get('/datasets', async (c) => {
    const datasets = await useCases.listDatasets.execute();
    return c.json({ datasets });
  });

  app.get('/datasets/:datasetId', async (c) => {
    const id = c.req.param('datasetId') as DatasetId;
    try {
      const result = await useCases.getDataset.execute(id);
      return c.json(result);
    } catch (err) {
      if (err instanceof DatasetNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  app.post('/datasets/:datasetId/examples', zValidator('json', uploadExamplesSchema), async (c) => {
    const id = c.req.param('datasetId') as DatasetId;
    const body = c.req.valid('json');
    try {
      const examples = await useCases.uploadExamples.execute({ datasetId: id, examples: body.examples });
      return c.json({ count: examples.length, examples }, 201);
    } catch (err) {
      if (err instanceof DatasetNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  // ── Evaluation Runs ───────────────────────────────────────────────────────

  app.get('/runs', async (c) => {
    const datasetId = c.req.query('datasetId');
    const runs = await useCases.listEvaluationRuns.execute(datasetId);
    return c.json({ runs });
  });

  app.post('/runs', zValidator('json', startRunSchema), async (c) => {
    const body = c.req.valid('json');
    try {
      const run = await useCases.startEvaluationRun.execute({
        datasetId: body.datasetId as DatasetId,
        agentVersion: body.agentVersion,
        agentUrl: body.agentUrl,
        metrics: body.metrics,
      });
      return c.json(run, 201);
    } catch (err) {
      if (err instanceof DatasetNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  app.post('/runs/:runId/execute', async (c) => {
    const runId = c.req.param('runId') as EvaluationRunId;
    try {
      // fire-and-forget so the response returns immediately
      const result = await useCases.executeEvaluationRun.execute(runId);
      return c.json(result);
    } catch (err) {
      if (err instanceof EvaluationRunNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  app.get('/runs/:runId', async (c) => {
    const runId = c.req.param('runId') as EvaluationRunId;
    try {
      const run = await useCases.getEvaluationRun.execute(runId);
      return c.json(run);
    } catch (err) {
      if (err instanceof EvaluationRunNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  // ── Results ───────────────────────────────────────────────────────────────

  app.get('/runs/:runId/results', async (c) => {
    const runId = c.req.param('runId') as EvaluationRunId;
    try {
      const results = await useCases.listEvaluationResults.execute(runId);
      return c.json({ results });
    } catch (err) {
      if (err instanceof EvaluationRunNotFoundError) return c.json({ error: err.message }, 404);
      throw err;
    }
  });

  return app;
}
