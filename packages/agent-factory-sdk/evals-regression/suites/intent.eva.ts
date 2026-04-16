import { evalSuite } from '../../../tracing-sdk/src/eval/eval-runner';
import { detectIntent } from '../../src/agents/actors/detect-intent.actor';

const model = process.env.EVAL_MODEL || 'azure/gpt-5.2-chat';

const scenarios = [
  { id: 'greeting', input: 'Hello', expectedIntent: 'greeting', previous: [] },
  { id: 'goodbye', input: 'Thanks, bye bye', expectedIntent: 'goodbye', previous: [] },
  { id: 'weather', input: 'What is the weather like today?', expectedIntent: 'other', previous: [] },
  { id: 'read-data-fr', input: 'Combien de clients ont acheté des produits de plus de 1000$', expectedIntent: 'read-data', previous: [] },
  { id: 'read-data-context', input: 'Hello, how are you?', expectedIntent: 'read-data', previous: [
      {
        id: 'msg-1', role: 'user', content: 'Combien de clients', parts: [{ type: 'text', text: 'Combien de clients' }]
      }
  ] },
];

await evalSuite(`Intent Agent Evaluation - ${model}`, {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'intent-v1',
  agentVersion: model.replace('/', '-'),
  metrics: { overall: [] },
  cases: scenarios.map(scenario => ({
    id: scenario.id,
    input: scenario.input,
    goldenOutput: JSON.stringify({ intent: scenario.expectedIntent }),
    agent: async (input) => {
      const streamResult = await detectIntent(input, scenario.previous as any, model);
      return JSON.stringify(streamResult.result);
    },
    customMetrics: [
      {
        name: 'exact_intent_match',
        fn: (output) => {
          try {
            const obj = JSON.parse(output);
            return obj.intent === scenario.expectedIntent ? 1 : 0;
          } catch {
            return 0;
          }
        }
      }
    ]
  }))
});
