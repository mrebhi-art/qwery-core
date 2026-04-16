import { randomUUID } from 'node:crypto';
import type { UIMessage } from 'ai';
import { createOtelNullTelemetryService } from '@qwery/telemetry/otel';
import { prompt } from '../../../src/agents/agent-session';
import { ensureSeededDuckDb } from '../single-turn/data';
import { readEnv } from '../single-turn/env';
import { readSseEvents } from '../single-turn/flow';
import { createRepositories, seedWorkspace } from '../single-turn/workspace';
import { readQuestions } from './questions';
import { getLastAssistantText, printTranscript } from './transcript';
import type { PersistedMessageLite } from './types';

export async function runMultiTurn(): Promise<void> {
  const rawConfig = readEnv();
  const config = await ensureSeededDuckDb(rawConfig);
  const questions = readQuestions();

  const repositories = createRepositories();
  const telemetry = createOtelNullTelemetryService();

  const { conversationId, conversationSlug } = await seedWorkspace(
    repositories,
    config,
  );

  console.log('--- Internal Agent Multi Turn ---');
  console.log(`agent: ${config.agentId}`);
  console.log(`model: ${config.model}`);
  console.log(`datasourceId: ${config.datasourceId}`);
  console.log(`conversationSlug: ${conversationSlug}`);
  console.log(`turns: ${questions.length}`);
  console.log('');

  for (let i = 0; i < questions.length; i += 1) {
    const question = questions[i]!;
    const message: UIMessage = {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: question }],
    };

    const response = await prompt({
      conversationSlug,
      messages: [message],
      agentId: config.agentId,
      model: config.model,
      repositories,
      datasources: [config.datasourceId],
      telemetry,
      maxSteps: 5,
    });

    if (!response.body) {
      throw new Error(`No stream body returned on turn ${i + 1}`);
    }

    await readSseEvents(response.body);

    const persistedMessages =
      (await repositories.message.findByConversationId(
        conversationId,
      )) as PersistedMessageLite[];
    const assistantText = getLastAssistantText(persistedMessages);

    console.log(`Turn ${i + 1}:`);
    console.log(`Q: ${question}`);
    console.log(
      `A: ${assistantText.length > 0 ? assistantText : '(empty assistant response)'}`,
    );
    console.log('');
  }

  const transcript =
    (await repositories.message.findByConversationId(
      conversationId,
    )) as PersistedMessageLite[];
  printTranscript(transcript);
}
