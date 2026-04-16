/**
 * Example eval script showing how to use evalSuite from @qwery/tracing-sdk.
 *
 * Run this from any project that has @qwery/tracing-sdk installed:
 *
 *   npx tsx src/eval/example.ts
 *
 * The script will:
 * 1. Create (or reuse) a dataset named 'example-agent-v1' in the qwery-eval backend
 * 2. Upload the example cases as dataset examples
 * 3. Start an evaluation run
 * 4. Run the mock agent function for each case
 * 5. Score custom metrics client-side
 * 6. POST results to the /execute-inline endpoint for built-in scoring + persistence
 * 7. Print a colour-coded summary table
 *
 * In a real project, replace `mockAgent` with your actual agent call, e.g.:
 *
 *   const { text } = await runAskAgentTurn(input, 'azure/gpt-4o-mini');
 *   return text;
 */

import { evalSuite } from './eval-runner';

// ─── Mock agent — replace with your real agent ───────────────────────────────

async function mockAgent(input: string): Promise<string> {
  // Simulate a simple SQL agent
  if (input.toLowerCase().includes('revenue')) {
    return 'SELECT month, SUM(revenue) FROM sales GROUP BY month ORDER BY month';
  }
  if (input.toLowerCase().includes('customers')) {
    return 'SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY customer_id ORDER BY total DESC LIMIT 10';
  }
  return `SELECT * FROM data WHERE query = '${input}'`;
}

// ─── Run the eval suite ───────────────────────────────────────────────────────

await evalSuite('Example Agent Evaluation', {
  baseUrl: process.env.EVAL_BASE_URL ?? 'http://localhost:4097',
  datasetName: 'example-agent-v1',
  agentVersion: '1.0.0',

  // Built-in metrics scored server-side
  metrics: {
    sql: ['sql_syntax_valid', 'sql_normalized_match'],
    overall: ['string_similarity'],
  },

  cases: [
    {
      id: 'monthly-revenue',
      input: 'Show me total revenue by month',
      groundTruth: 'SELECT month, SUM(revenue) FROM sales GROUP BY month ORDER BY month',

      // ← Your agent function runs here directly (same process, no HTTP)
      agent: async (input) => mockAgent(input),

      // ← Custom metrics — plain functions, scored client-side
      customMetrics: [
        {
          name: 'has_group_by',
          fn: (output) => /GROUP\s+BY/i.test(output) ? 1 : 0,
        },
        {
          name: 'references_sales_table',
          fn: (output) => /\bsales\b/i.test(output) ? 1 : 0,
        },
      ],
    },
    {
      id: 'top-customers',
      input: 'Who are the top 10 customers by revenue?',
      groundTruth:
        'SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY customer_id ORDER BY total DESC LIMIT 10',

      agent: async (input) => mockAgent(input),

      customMetrics: [
        {
          name: 'has_limit_10',
          fn: (output) => /LIMIT\s+10/i.test(output) ? 1 : 0,
        },
        {
          name: 'has_order_by_desc',
          fn: (output) => /ORDER\s+BY\s+\w+\s+DESC/i.test(output) ? 1 : 0,
        },
      ],
    },
  ],
});
