/**
 * Tool Sequence — single-turn dataset
 *
 * Tests the Ask agent's awareness of when and in what order to call tools.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/single-turn/tool-sequence.dataset.ts
 */

import { EvalDataset } from '@qwery/tracing-sdk/eval';

export const toolSequenceDataset = new EvalDataset({
  name: 'tool-sequence-evals',
  description: 'Ask agent tool ordering and awareness tests (schema-first, query-intent, conversational)',
  goldens: [
    {
      id: 'tool-schema-first',
      input: 'What columns does the orders table have?',
      groundTruth: 'schema',
      customMetrics: [
        { name: 'mentions_schema', fn: (out) => /schema|column|table|structure|field/i.test(out) ? 1 : 0 },
        { name: 'is_substantive', fn: (out) => out.trim().length > 50 ? 1 : 0 },
        { name: 'mentions_expected_orders_columns', fn: (out) => /order_id/i.test(out) && /customer_id/i.test(out) && /order_date/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'tool-query-intent',
      input: 'Run a query to show total revenue by region from the orders table',
      groundTruth: 'query',
      customMetrics: [
        { name: 'returns_region_aggregation', fn: (out) => /region/i.test(out) && /(revenue|total revenue|136,?000|124,?000|118,?000|97,?000)/i.test(out) ? 1 : 0 },
        { name: 'mentions_region_or_revenue', fn: (out) => /region|revenue|sales/i.test(out) ? 1 : 0 },
        { name: 'is_substantive', fn: (out) => out.trim().length > 50 ? 1 : 0 },
      ],
    },
    {
      id: 'tool-conversational',
      input: 'What is the difference between an INNER JOIN and a LEFT OUTER JOIN in SQL?',
      groundTruth: 'inner join returns only matching rows',
      customMetrics: [
        { name: 'explains_inner_join', fn: (out) => /inner|match(ing)?/i.test(out) ? 1 : 0 },
        { name: 'explains_outer_join', fn: (out) => /outer|left|null|all row/i.test(out) ? 1 : 0 },
        { name: 'is_substantive', fn: (out) => out.trim().length > 100 ? 1 : 0 },
      ],
    },
    {
      id: 'tool-needs-datasource',
      input: 'Can you query my database and tell me how many records are in the products table from my own datasource?',
      groundTruth: 'datasource',
      customMetrics: [
        { name: 'mentions_datasource_or_connect', fn: (out) => /datasource|connect|database|schema|attach/i.test(out) ? 1 : 0 },
        { name: 'mentions_query_limit_or_next_step', fn: (out) => /query|attach|first|then|once/i.test(out) ? 1 : 0 },
        { name: 'is_substantive', fn: (out) => out.trim().length > 30 ? 1 : 0 },
      ],
    },
    {
      id: 'tool-schema-then-query',
      input: 'First check the schema of the orders table, then count how many orders we have by region',
      groundTruth: 'schema',
      customMetrics: [
        { name: 'mentions_schema_step', fn: (out) => /schema|column|table|structure/i.test(out) ? 1 : 0 },
        { name: 'mentions_count_or_region', fn: (out) => /count|region|group by|orders/i.test(out) ? 1 : 0 },
        { name: 'is_substantive', fn: (out) => out.trim().length > 50 ? 1 : 0 },
      ],
    },
    {
      id: 'tool-clarify-before-query',
      input: 'Show me revenue performance from the sales table.',
      groundTruth: 'clarify',
      customMetrics: [
        { name: 'offers_refinement_or_follow_up', fn: (out) => /would you like|break this down|by region|by month|product category|chart/i.test(out) ? 1 : 0 },
        { name: 'mentions_revenue_or_sales', fn: (out) => /revenue|sales/i.test(out) ? 1 : 0 },
        { name: 'is_substantive', fn: (out) => out.trim().length > 40 ? 1 : 0 },
      ],
    },
  ],
});

await toolSequenceDataset.push();

