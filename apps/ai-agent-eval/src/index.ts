import { createApp } from './server';
import { getLogger } from '@qwery/shared/logger';

const port = Number(process.env['PORT'] ?? 4097);
const app = createApp();

const logger = await getLogger();
logger.info({ port }, '[ai-agent-eval] Starting AI Agent Evaluation microservice');

export default {
  port,
  fetch: app.fetch,
};
