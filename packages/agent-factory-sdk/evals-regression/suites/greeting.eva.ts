import { evalSuite } from '../../../tracing-sdk/src/eval/eval-runner';
import { greeting } from '../../src/agents/actors/greeting.actor';

const model = process.env.EVAL_MODEL || 'azure/gpt-5.2-chat';

await evalSuite(`Greeting Agent Evaluation - ${model}`, {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'greeting-v1',
  agentVersion: model.replace('/', '-'),
  metrics: { overall: [] },
  cases: [
    {
      id: 'simple-greeting',
      input: 'Hello',
      goldenOutput: 'Hello! How can I help you today?',
      agent: async (input) => {
        const result = await greeting(input, model);
        return await result.text;
      },
      customMetrics: [
        {
          name: 'valid_length',
          fn: (output) => output.length > 5 ? 1 : 0,
        }
      ]
    },
    {
      id: 'informal-greeting',
      input: 'Hi there! How is it going?',
      goldenOutput: 'Hi! I am doing well, how can I help?',
      agent: async (input) => {
        const result = await greeting(input, model);
        return await result.text;
      },
      customMetrics: [
        {
          name: 'valid_length',
          fn: (output) => output.length > 5 ? 1 : 0,
        }
      ]
    },
    {
      id: 'formal-greeting',
      input: 'Good morning',
      goldenOutput: 'Good morning! How may I assist you?',
      agent: async (input) => {
        const result = await greeting(input, model);
        return await result.text;
      },
      customMetrics: [
        {
          name: 'valid_length',
          fn: (output) => output.length > 5 ? 1 : 0,
        }
      ]
    }
  ]
});
