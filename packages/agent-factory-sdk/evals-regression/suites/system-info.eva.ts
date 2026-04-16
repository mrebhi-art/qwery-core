import { evalSuite } from '../../../tracing-sdk/src/eval/eval-runner';
import { systemInfo } from '../../src/agents/actors/system-info.actor';

const model = process.env.EVAL_MODEL || 'azure/gpt-5.2-chat';

await evalSuite(`System Info Agent Evaluation - ${model}`, {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'system-info-v1',
  agentVersion: model.replace('/', '-'),
  metrics: { overall: [] },
  cases: [
    {
      id: 'identity-check',
      input: 'Who are you?',
      goldenOutput: 'I am Qwery.',
      agent: async (input) => {
        const result = await systemInfo(input);
        return await result.text;
      },
      customMetrics: [
        {
          name: 'mentions_qwery',
          fn: (output) => output.toLowerCase().includes('qwery') ? 1 : 0,
        }
      ]
    },
    {
      id: 'platform-description',
      input: 'What is Qwery?',
      goldenOutput: 'Qwery is a data platform.',
      agent: async (input) => {
        const result = await systemInfo(input);
        return await result.text;
      },
      customMetrics: [
        {
          name: 'mentions_keywords',
          fn: (output) => {
            const out = output.toLowerCase();
            return out.includes('qwery') && out.includes('platform') && out.includes('data') ? 1 : 0;
          }
        }
      ]
    },
    {
      id: 'system-version',
      input: 'What version of Qwery is this?',
      goldenOutput: 'Qwery version 1.1.0',
      agent: async (input) => {
        const result = await systemInfo(input);
        return await result.text;
      },
      customMetrics: [
        {
          name: 'mentions_version',
          fn: (output) => {
            const out = output.toLowerCase();
            return out.includes('version') && out.includes('1.1.0') ? 1 : 0;
          }
        }
      ]
    }
  ]
});
