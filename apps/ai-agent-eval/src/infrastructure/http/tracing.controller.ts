import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { CreateTraceUseCase } from '../../application/use-cases/create-trace.use-case';
import type { AddStepUseCase } from '../../application/use-cases/add-step.use-case';
import type { CompleteTraceUseCase } from '../../application/use-cases/complete-trace.use-case';
import type { FailTraceUseCase } from '../../application/use-cases/fail-trace.use-case';
import type { GetTraceUseCase } from '../../application/use-cases/get-trace.use-case';
import type { ListTracesUseCase } from '../../application/use-cases/list-traces.use-case';
import {
  TraceNotFoundError,
  TraceAccessDeniedError,
} from '../../application/errors';
import { TraceDomainError } from '../../domain/trace';

// ─── Hono typed variables ─────────────────────────────────────────────────────

type HonoVariables = { apiKey: string };

// ─── Schemas ──────────────────────────────────────────────────────────────────

const tokenUsageSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .optional()
  .nullable();

const createTraceSchema = z.object({
  projectId: z.string().min(1),
  agentVersion: z.string().min(1),
  modelName: z.string().min(1),
  input: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const addStepSchema = z.object({
  type: z.enum(['llm_call', 'tool_call', 'retrieval', 'reasoning', 'custom']),
  name: z.string().min(1),
  input: z.unknown(),
  output: z.unknown(),
  error: z.string().nullable().optional(),
  latencyMs: z.number().int().nonnegative(),
  tokenUsage: tokenUsageSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  artifacts: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(['table', 'chart', 'image', 'sql', 'text']),
        mimeType: z.string().min(1),
        data: z.string(),
        encoding: z.enum(['utf8', 'base64']),
      }),
    )
    .optional(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
});

const completeTraceSchema = z.object({
  output: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const failTraceSchema = z.object({
  error: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  status: z.enum(['running', 'completed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─── Controller factory ───────────────────────────────────────────────────────

type TracingUseCases = {
  createTrace: CreateTraceUseCase;
  addStep: AddStepUseCase;
  completeTrace: CompleteTraceUseCase;
  failTrace: FailTraceUseCase;
  getTrace: GetTraceUseCase;
  listTraces: ListTracesUseCase;
};

function extractApiKey(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

function handleError(error: unknown): Response {
  if (error instanceof TraceNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof TraceAccessDeniedError) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (error instanceof TraceDomainError) {
    return Response.json({ error: error.message }, { status: 422 });
  }
  const message = error instanceof Error ? error.message : 'Internal server error';
  return Response.json({ error: message }, { status: 500 });
}

export function createTracingRoutes(useCases: TracingUseCases) {
  const app = new Hono<{ Variables: HonoVariables }>();

  // ─── Auth middleware ────────────────────────────────────────────────────────
  app.use('*', async (c, next) => {
    const apiKey = extractApiKey(c.req.header('Authorization'));
    if (!apiKey) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }
    c.set('apiKey', apiKey);
    await next();
  });

  // ─── POST /traces ───────────────────────────────────────────────────────────
  app.post('/', zValidator('json', createTraceSchema), async (c) => {
    try {
      const body = c.req.valid('json');
      const apiKey = c.get('apiKey');
      const trace = await useCases.createTrace.execute({ ...body, apiKey });
      return c.json(trace, 201);
    } catch (e) {
      return handleError(e);
    }
  });

  // ─── GET /traces ────────────────────────────────────────────────────────────
  app.get('/', zValidator('query', listQuerySchema), async (c) => {
    try {
      const query = c.req.valid('query');
      const apiKey = c.get('apiKey');
      const traces = await useCases.listTraces.execute({
        apiKey,
        filter: query,
      });
      return c.json(traces);
    } catch (e) {
      return handleError(e);
    }
  });

  // ─── GET /traces/:id ────────────────────────────────────────────────────────
  app.get('/:id', async (c) => {
    try {
      const apiKey = c.get('apiKey');
      const trace = await useCases.getTrace.execute({
        traceId: c.req.param('id') as ReturnType<typeof import('../../domain/trace').newTraceId>,
        apiKey,
      });
      return c.json(trace);
    } catch (e) {
      return handleError(e);
    }
  });

  // ─── POST /traces/:id/steps ─────────────────────────────────────────────────
  app.post('/:id/steps', zValidator('json', addStepSchema), async (c) => {
    try {
      const body = c.req.valid('json');
      const apiKey = c.get('apiKey');
      const trace = await useCases.addStep.execute({
        traceId: c.req.param('id') as ReturnType<typeof import('../../domain/trace').newTraceId>,
        apiKey,
        ...body,
      });
      return c.json(trace);
    } catch (e) {
      return handleError(e);
    }
  });

  // ─── POST /traces/:id/complete ──────────────────────────────────────────────
  app.post('/:id/complete', zValidator('json', completeTraceSchema), async (c) => {
    try {
      const body = c.req.valid('json');
      const apiKey = c.get('apiKey');
      const trace = await useCases.completeTrace.execute({
        traceId: c.req.param('id') as ReturnType<typeof import('../../domain/trace').newTraceId>,
        apiKey,
        ...body,
      });
      return c.json(trace);
    } catch (e) {
      return handleError(e);
    }
  });

  // ─── POST /traces/:id/fail ──────────────────────────────────────────────────
  app.post('/:id/fail', zValidator('json', failTraceSchema), async (c) => {
    try {
      const body = c.req.valid('json');
      const apiKey = c.get('apiKey');
      const trace = await useCases.failTrace.execute({
        traceId: c.req.param('id') as ReturnType<typeof import('../../domain/trace').newTraceId>,
        apiKey,
        ...body,
      });
      return c.json(trace);
    } catch (e) {
      return handleError(e);
    }
  });

  return app;
}