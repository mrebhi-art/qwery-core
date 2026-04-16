/**
 * SQL Quality — single-turn dataset
 *
 * Tests the Ask agent's ability to produce and describe correct SQL.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/single-turn/sql-quality.dataset.ts
 */

import { EvalDataset } from '@qwery/tracing-sdk/eval';

export const sqlQualityDataset = new EvalDataset({
  name: 'sql-quality-evals',
  description: 'Ask agent SQL generation quality tests — count, aggregation, join, filter, top-N, date range',
  goldens: [
    {
      id: 'sql-count',
      input: 'How would I write a SQL query to count all the orders in a database?',
      groundTruth: 'SELECT COUNT(*) FROM orders',
      customMetrics: [
        { name: 'contains_select', fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0 },
        { name: 'contains_count', fn: (out) => /\bCOUNT\b/i.test(out) ? 1 : 0 },
        { name: 'has_no_apology', fn: (out) => /i (cannot|can't|am unable)/i.test(out) ? 0 : 1 },
      ],
    },
    {
      id: 'sql-aggregation',
      input: 'How would I write a SQL query to get the total sales amount for each region?',
      groundTruth: 'SELECT region, SUM(sales) FROM orders GROUP BY region',
      customMetrics: [
        { name: 'contains_select', fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0 },
        { name: 'has_group_by', fn: (out) => /GROUP\s+BY/i.test(out) ? 1 : 0 },
        { name: 'has_aggregate', fn: (out) => /\b(SUM|COUNT|AVG|MAX|MIN)\b/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'sql-join',
      input: "How would I write a SQL query to join the customers and orders tables to get each customer's order total?",
      groundTruth:
        'SELECT customers.name, SUM(orders.total) FROM customers JOIN orders ON customers.id = orders.customer_id GROUP BY customers.name',
      customMetrics: [
        { name: 'contains_select', fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0 },
        { name: 'has_join', fn: (out) => /\bJOIN\b/i.test(out) ? 1 : 0 },
        { name: 'mentions_customers_and_orders', fn: (out) => /customer/i.test(out) && /order/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'sql-filter',
      input: 'How would I write a SQL query to get all orders where the total is greater than 500?',
      groundTruth: 'SELECT * FROM orders WHERE total > 500',
      customMetrics: [
        { name: 'contains_select', fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0 },
        { name: 'has_where_clause', fn: (out) => /\bWHERE\b/i.test(out) ? 1 : 0 },
        { name: 'mentions_500', fn: (out) => /500/.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'sql-top-n',
      input: 'How would I write a SQL query to find the top 3 products ranked by total revenue?',
      groundTruth:
        'SELECT product, SUM(revenue) AS total_revenue FROM sales GROUP BY product ORDER BY total_revenue DESC LIMIT 3',
      customMetrics: [
        { name: 'contains_select', fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0 },
        { name: 'has_limit_or_top', fn: (out) => /\bLIMIT\b|\bTOP\s+\d/i.test(out) ? 1 : 0 },
        { name: 'has_order_by', fn: (out) => /ORDER\s+BY/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'sql-date',
      input: 'How would I write a SQL query to filter sales records from Q1 2024, between January and March?',
      groundTruth: "SELECT * FROM sales WHERE date BETWEEN '2024-01-01' AND '2024-03-31'",
      customMetrics: [
        { name: 'contains_select', fn: (out) => /\bSELECT\b/i.test(out) ? 1 : 0 },
        { name: 'has_date_filter', fn: (out) => /\bWHERE\b|\bBETWEEN\b/i.test(out) ? 1 : 0 },
        { name: 'mentions_date_range', fn: (out) => /2024|january|march|q1|quarter/i.test(out) ? 1 : 0 },
      ],
    },
  ],
});

await sqlQualityDataset.push();

