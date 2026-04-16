import { randomUUID } from 'node:crypto';
import type { UIMessage } from 'ai';
import { createOtelNullTelemetryService } from '@qwery/telemetry/otel';
import { prompt } from '../../../src/agents/agent-session';
import { readEnv } from './env';
import { ensureSeededDuckDb, buildFallbackAnswer } from './data';
import { readSseEvents, summarizeEventPayload, summarizeToolParts } from './flow';
import { createRepositories, seedWorkspace } from './workspace';

export async function runSingleTurn(): Promise<void> {
  const rawConfig = readEnv();
  const config = await ensureSeededDuckDb(rawConfig);
  const configuredMaxStepsRaw =
    process.env['MAX_STEPS'] ?? process.env['QWERY_MAX_STEPS'] ?? '12';
  const configuredMaxSteps = Number.parseInt(configuredMaxStepsRaw, 10);
  const maxSteps = Number.isFinite(configuredMaxSteps) && configuredMaxSteps > 0
    ? configuredMaxSteps
    : 12;
  const repositories = createRepositories();
  const telemetry = createOtelNullTelemetryService();
  const toolMetadataEvents: Array<Record<string, unknown>> = [];
  const askEvents: Array<Record<string, unknown>> = [];

  const { conversationId, conversationSlug } = await seedWorkspace(
    repositories,
    config,
  );

  const message: UIMessage = {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: config.question }],
  };

  const response = await prompt({
    conversationSlug,
    messages: [message],
    agentId: config.agentId,
    model: config.model,
    repositories,
    datasources: [config.datasourceId],
    telemetry,
    onAsk: async (req) => {
      askEvents.push({
        permission: req.permission,
        patterns: req.patterns,
        metadata: req.metadata,
      });
    },
    onToolMetadata: async (meta) => {
      toolMetadataEvents.push({
        callId: meta.callId,
        messageId: meta.messageId,
        title: meta.title,
        metadata: meta.metadata,
      });
    },
    maxSteps,
  });

  if (!response.body) {
    throw new Error('Agent session returned no stream body');
  }

  const flowEvents = await readSseEvents(response.body);

  const persistedMessages = await repositories.message.findByConversationId(
    conversationId,
  );
  const lastAssistant = [...persistedMessages]
    .reverse()
    .find((m) => m.role === 'assistant');
  const assistantText =
    lastAssistant?.content?.parts
      ?.filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
      .trim() ?? '';

  const usages = await repositories.usage.findByConversationId(conversationId);
  const lastUsage = usages.length > 0 ? usages[usages.length - 1] : null;

  console.log('--- Internal Agent Single Turn ---');
  console.log(`agent: ${config.agentId}`);
  console.log(`model: ${config.model}`);
  console.log(`datasourceId: ${config.datasourceId}`);
  console.log(`conversationSlug: ${conversationSlug}`);
  console.log(`maxSteps: ${maxSteps}`);
  console.log('');
  console.log('question:');
  console.log(config.question);
  console.log('');

  if (config.flowMode === 'full') {
    console.log('flow events:');
    for (const event of flowEvents) {
      console.log(`[${event.index}] ${summarizeEventPayload(event.payload)}`);
    }
    console.log('');

    if (toolMetadataEvents.length > 0) {
      console.log('tool metadata events:');
      console.log(JSON.stringify(toolMetadataEvents, null, 2));
      console.log('');
    }

    if (askEvents.length > 0) {
      console.log('ask events:');
      console.log(JSON.stringify(askEvents, null, 2));
      console.log('');
    }

    console.log('persisted messages:');
    console.log(
      JSON.stringify(
        persistedMessages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: m.content?.parts ?? [],
        })),
        null,
        2,
      ),
    );
    console.log('');
  } else {
    const assistantParts =
      lastAssistant?.content?.parts && Array.isArray(lastAssistant.content.parts)
        ? lastAssistant.content.parts
        : [];
    const toolSummary = summarizeToolParts(assistantParts as unknown[]);
    console.log('flow summary:');
    console.log(
      JSON.stringify(
        {
          mode: config.flowMode,
          totalEvents: flowEvents.length,
          tools: toolSummary,
          toolMetadataCount: toolMetadataEvents.length,
          askEventCount: askEvents.length,
        },
        null,
        2,
      ),
    );
    console.log('');
  }

  console.log('answer:');
  if (assistantText.length > 0) {
    console.log(assistantText);
  } else {
    const fallback = await buildFallbackAnswer(config);
    console.log(
      fallback ??
        'Agent returned an empty final response. Check provider/tool settings and retry.',
    );
  }

  if (lastUsage) {
    console.log('');
    console.log('usage:');
    console.log(
      JSON.stringify(
        {
          model: lastUsage.model,
          inputTokens: lastUsage.inputTokens,
          outputTokens: lastUsage.outputTokens,
          totalTokens: lastUsage.totalTokens,
          costInCredits: lastUsage.costInCredits,
        },
        null,
        2,
      ),
    );
  }
}
