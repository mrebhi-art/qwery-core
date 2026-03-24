import { evalSuite } from '../../../tracing-sdk/src/eval/eval-runner';
import { readDataAgent } from '../../src/agents/actors/read-data-agent.actor';
import { AbstractQueryEngine } from '@qwery/domain/ports';
import { Repositories } from '@qwery/domain/repositories';
import { DatasourceMetadata, DatasourceResultSet } from '@qwery/extensions-sdk';
import { UIMessage } from 'ai';

const model = process.env.EVAL_MODEL || 'azure/gpt-5.2-chat';

class MockQueryEngine extends AbstractQueryEngine {
  async initialize() {}
  async attach() {}
  async detach() {}
  async connect() {}
  async close() {}
  async query() {
    return {
      columns: [
        { name: 'id', displayName: 'ID', originalType: 'INTEGER' },
        { name: 'name', displayName: 'Name', originalType: 'VARCHAR' },
      ],
      rows: [{ id: 1, name: 'Test' }],
      stat: { rowsAffected: 1, queryDurationMs: 0, rowsRead: 1, rowsWritten: 0 },
    } as DatasourceResultSet;
  }
  async metadata() {
    return Promise.resolve({} as DatasourceMetadata);
  }
}

const mockRepos = {
  datasource: { findAll: async () => [], findById: async () => null },
  project: { findById: async () => null },
} as unknown as Repositories;

const scenarios = [
  { id: 'data-discovery', input: 'What tables do I have?', expected: 'schema' },
  { id: 'simple-query', input: 'How many users are there?', expected: 'query' },
];

await evalSuite(`Read Data Agent Evaluation - ${model}`, {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'read-data-v1',
  agentVersion: model.replace('/', '-'),
  metrics: { overall: [] },
  cases: scenarios.map(scenario => ({
    id: scenario.id,
    input: scenario.input,
    goldenOutput: 'Mock successful response',
    agent: async (input) => {
      const agent = await readDataAgent(
        'test-conv',
        [{ id: '1', role: 'user', parts: [{ type: 'text', text: input }] }] as UIMessage[],
        model,
        new MockQueryEngine() as unknown as AbstractQueryEngine,
        mockRepos,
      );
      return await agent.text;
    },
    customMetrics: [
      {
        name: 'non_empty_response',
        fn: (output) => output.length > 5 ? 1 : 0,
      }
    ]
  }))
});
