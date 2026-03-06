import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { createTracingRoutes } from './infrastructure/http/tracing.controller';
import { createDashboardRoutes } from './infrastructure/http/dashboard.controller';
import { createEvaluationRoutes } from './infrastructure/http/evaluation.controller';
import { getContainer } from './infrastructure/container';

export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', cors());

  app.get('/health', (c) => c.json({ status: 'ok', service: 'ai-agent-eval' }));

  const { useCases } = getContainer();

  // Dashboard — explicit paths, no ambiguity
  const dashboard = createDashboardRoutes(useCases);
  app.route('/dashboard', dashboard);

  // Redirect root to dashboard
  app.get('/', (c) => c.redirect('/dashboard'));

  // Write API at /traces (requires Bearer auth)
  app.route('/traces', createTracingRoutes(useCases));

  // Evaluation API
  app.route('/evaluation', createEvaluationRoutes(useCases));

  return app;
}
