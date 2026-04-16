/**
 * Ask Agent (Qwery Core) — single-turn dataset
 *
 * NL→SQL, chart recommendations, and schema-grounded analysis planning.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/single-turn/ask-agent.dataset.ts
 */

import { EvalDataset } from '@qwery/tracing-sdk/eval';

export const askAgentDataset = new EvalDataset({
  name: 'ask-agent-core-evals',
  description: 'Ask agent core evaluation: SQL generation, chart recommendation, analysis planning',
  goldens: [
    {
      id: 'sql-revenue-by-region',
      // Exact SQL golden — the LLM task_completion judge needs concrete expected output.
      // Agent wraps SQL in markdown prose, so string_similarity will be moderate (~0.2);
      // correctness is primarily tracked via custom structural metrics.
      input: 'Write SQL for total revenue by region from orders table.',
      groundTruth:
        'SELECT region, SUM(revenue) AS total_revenue FROM orders GROUP BY region',
      customMetrics: [
        { name: 'contains_select', fn: (out) => /\bselect\b/i.test(out) ? 1 : 0 },
        { name: 'contains_group_by', fn: (out) => /\bgroup\s+by\b/i.test(out) ? 1 : 0 },
        { name: 'contains_sum', fn: (out) => /\bsum\s*\(/i.test(out) ? 1 : 0 },
        { name: 'references_orders_table', fn: (out) => /\borders\b/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'sql-monthly-trend',
      // Golden uses month column + date function — agent may use strftime, date_trunc, or month column.
      input: 'Generate SQL for monthly sales trend in 2024.',
      groundTruth:
        "SELECT month, SUM(revenue) AS total_revenue FROM sales GROUP BY month ORDER BY month",
      customMetrics: [
        // Matches GROUP BY month, GROUP BY strftime(...), GROUP BY date_trunc(...), GROUP BY 1
        { name: 'has_date_grouping', fn: (out) => /group\s+by\b.{0,120}(month|strftime|date_trunc|\b1\b)/i.test(out) ? 1 : 0 },
        { name: 'has_order_by', fn: (out) => /\border\s+by\b/i.test(out) ? 1 : 0 },
        { name: 'has_aggregation', fn: (out) => /\bsum\s*\(/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'sql-top-products',
      input: 'Provide SQL for top 5 products by revenue.',
      groundTruth:
        'SELECT product, SUM(revenue) AS total_revenue FROM sales GROUP BY product ORDER BY total_revenue DESC LIMIT 5',
      customMetrics: [
        { name: 'has_limit', fn: (out) => /\blimit\s+5\b/i.test(out) ? 1 : 0 },
        { name: 'has_desc_sort', fn: (out) => /\bdesc\b/i.test(out) ? 1 : 0 },
        { name: 'has_group_by', fn: (out) => /\bgroup\s+by\b/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'sql-join-customers-orders',
      // customers table is now in the synthetic schema — agent should produce a real JOIN.
      input: 'Write SQL joining customers and orders to compute total spend per customer.',
      groundTruth:
        'SELECT c.customer_id, SUM(o.revenue) AS total_spend FROM customers c JOIN orders o ON c.customer_id = o.customer_id GROUP BY c.customer_id',
      customMetrics: [
        { name: 'has_join', fn: (out) => /\bjoin\b/i.test(out) ? 1 : 0 },
        { name: 'has_on_clause', fn: (out) => /\bon\b.{0,60}customer_id/i.test(out) ? 1 : 0 },
        { name: 'has_group_by', fn: (out) => /\bgroup\s+by\b/i.test(out) ? 1 : 0 },
        { name: 'has_aggregation', fn: (out) => /\bsum\s*\(/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'chart-recommend-category-comparison',
      input: 'Which chart is best to compare revenue across product categories and why?',
      groundTruth: 'Bar chart is best for category comparison.',
      customMetrics: [
        { name: 'mentions_bar_chart', fn: (out) => /\bbar\b/i.test(out) ? 1 : 0 },
        { name: 'mentions_comparison_reason', fn: (out) => /compar|categor/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'chart-recommend-trend',
      input: 'Best chart to show monthly revenue trend over time?',
      groundTruth: 'Line chart for trend over time.',
      customMetrics: [
        { name: 'mentions_line_chart', fn: (out) => /\bline\b/i.test(out) ? 1 : 0 },
        { name: 'mentions_time_series', fn: (out) => /trend|time|month/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'chart-recommend-share',
      input: 'Suggest chart for market share distribution by company.',
      groundTruth: 'Pie or donut chart for share distribution.',
      customMetrics: [
        { name: 'mentions_pie_or_donut', fn: (out) => /\b(pie|donut)\b/i.test(out) ? 1 : 0 },
        { name: 'mentions_distribution', fn: (out) => /distribution|share/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'analysis-plan-schema-first',
      // Directive input — forces the agent to EXECUTE the workflow (schema → query → chart),
      // not just describe it. "What is your plan?" produces a planning monologue, not execution.
      input: 'Safely analyze the sales data: first check the schema, then run a focused revenue query, and show me a chart of the results.',
      groundTruth:
        'First inspect the schema to understand available tables and columns. Then validate assumptions about the data before running any query. Execute a scoped query and finally visualize the results as a chart.',
      customMetrics: [
        { name: 'mentions_schema_first', fn: (out) => /schema|column|table/i.test(out) ? 1 : 0 },
        { name: 'mentions_validation', fn: (out) => /validat|check|safe|confirm|verif/i.test(out) ? 1 : 0 },
        { name: 'mentions_visualization_step', fn: (out) => /chart|visual|graph|plot/i.test(out) ? 1 : 0 },
        // Checks the agent actually called a query tool, not just described one
        { name: 'ran_a_query', fn: (out) => /select\b|from\b|group\s+by/i.test(out) ? 1 : 0 },
      ],
    },
  ],
});

// ── Self-registration when file is run directly ───────────────────────────────
await askAgentDataset.push();

