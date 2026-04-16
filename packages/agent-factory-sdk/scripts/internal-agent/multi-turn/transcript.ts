import type { PersistedMessageLite } from './types';

function messageText(message: PersistedMessageLite): string {
  return (
    message.content?.parts
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim() ?? ''
  );
}

export function getLastAssistantText(messages: PersistedMessageLite[]): string {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  return lastAssistant ? messageText(lastAssistant) : '';
}

export function printTranscript(messages: PersistedMessageLite[]): void {
  console.log('Full transcript (role order):');
  for (const message of messages) {
    const text = messageText(message);
    console.log(`[${message.role}] ${text || '(non-text or empty)'}`);
  }
}
