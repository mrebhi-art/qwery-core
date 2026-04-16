/**
 * Latency & Token Usage — single-turn dataset
 *
 * Stress-tests token consumption with 500-row synthetic query results.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/single-turn/latency-token.dataset.ts
 */

import { EvalDataset } from '@qwery/tracing-sdk/eval';

export const latencyTokenDataset = new EvalDataset({
  name: 'latency-token-metrics',
  description: 'Token usage and latency stress tests with diverse, high-signal analytics requests for Mustache comparison',
  goldens: [
    {
      id: 'perf-sql-revenue-by-region',
      input: 'Write SQL to compute total sales revenue by region sorted descending.',
      groundTruth: 'SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region ORDER BY total_revenue DESC',
    },
    {
      id: 'perf-sql-monthly-revenue',
      input: 'Write SQL for month-over-month revenue totals.',
      groundTruth: 'SELECT month, SUM(revenue) AS total_revenue FROM sales GROUP BY month ORDER BY month',
    },
    {
      id: 'perf-sql-revenue-region',
      input: 'Show me the SQL query for revenue by region, highest to lowest.',
      groundTruth: 'SELECT region, SUM(revenue) AS total_revenue FROM sales GROUP BY region ORDER BY total_revenue DESC',
    },
    {
      id: 'perf-sql-top-products',
      input: 'Generate SQL for top 10 products by revenue.',
      groundTruth: 'SQL selecting product and SUM(revenue) with descending order and LIMIT 10.',
    },
    {
      id: 'perf-sql-segment-share',
      input: 'Write SQL to return customer segment revenue share percentage.',
      groundTruth: 'SQL with segment aggregation and percent-of-total calculation.',
    },
    {
      id: 'perf-sql-weekly-orders',
      input: 'Write SQL for total orders by week over the last 26 weeks.',
      groundTruth: 'SQL with date truncation to week and grouped order counts.',
    },
    {
      id: 'perf-sql-conversion-funnel',
      input: 'Return SQL to produce visits, checkout, and purchases in one funnel output.',
      groundTruth: 'SQL using conditional aggregation for funnel stages.',
    },
    {
      id: 'perf-growth-rate-sql',
      input: 'Write SQL to compute month over month revenue growth percentage.',
      groundTruth: 'SQL using monthly aggregation and lag to compute revenue growth percent.',
    },
    {
      id: 'perf-sql-profit-margin-by-region',
      input: 'Write SQL for profit margin by region using revenue and cost fields.',
      groundTruth: 'SQL computing (revenue - cost) / revenue by region.',
    },
    {
      id: 'perf-sql-state-revenue',
      input: 'Provide SQL for total revenue by US state.',
      groundTruth: 'SQL grouped by state with aggregated revenue.',
    },
    {
      id: 'perf-cohort-retention',
      input: 'Write SQL for monthly cohort retention for users who signed up this year.',
      groundTruth: 'A cohort retention matrix by signup month and active month.',
    },
    {
      id: 'perf-cancel-rate-by-plan',
      input: 'Write SQL to compare cancellation rate by subscription plan.',
      groundTruth: 'SQL computing cancellation rate grouped by plan.',
    },
    {
      id: 'perf-sql-anomaly-threshold',
      input: 'Write SQL to flag daily sales anomalies where sales deviate 3 standard deviations from average.',
      groundTruth: 'SQL using mean and standard deviation thresholding.',
    },
    {
      id: 'perf-sql-quarterly-margin',
      input: 'Write SQL for quarterly revenue, cost, and margin by product line.',
      groundTruth: 'SQL grouped by quarter and product line with margin calculation.',
    },
    {
      id: 'perf-sql-window-ranking',
      input: 'Generate SQL for ranking stores by profit within each region.',
      groundTruth: 'SQL using window functions to rank stores by regional profit.',
    },
    {
      id: 'perf-sql-top-countries-orders',
      input: 'Top 5 countries by orders. Return SQL only.',
      groundTruth: 'SQL grouped by country ordered by order count with limit 5.',
    },
    {
      id: 'perf-sql-forecast-series',
      input: 'Write SQL to return a monthly revenue time series for forecasting next quarter.',
      groundTruth: 'SQL producing month and revenue ordered chronologically.',
    },
    {
      id: 'perf-sql-salesperson-performance',
      input: 'Generate SQL for salesperson performance by revenue and average discount.',
      groundTruth: 'SQL grouped by salesperson with SUM(revenue) and AVG(discount).',
    },
    {
      id: 'perf-sql-margin-breakdown',
      input: 'Write SQL for gross sales, discounts, refunds, and net margin breakdown.',
      groundTruth: 'SQL with grouped financial components and derived net margin.',
    },
    {
      id: 'perf-sql-multi-filter-arr',
      input: 'For enterprise customers in EMEA, write SQL to compare Q1 and Q2 ARR by industry.',
      groundTruth: 'Industry-level ARR comparison for Q1 versus Q2 in EMEA enterprise segment.',
    },
    {
      id: 'perf-sql-date-bucketing',
      input: 'Write SQL to bucket transactions into 15-minute intervals.',
      groundTruth: 'SQL that groups transactions by 15-minute time buckets.',
    },
    {
      id: 'perf-sql-refund-impact',
      input: 'Write SQL to show refunds impact on net revenue over time.',
      groundTruth: 'SQL returning gross revenue, refunds, and net revenue by period.',
    },
    {
      id: 'perf-sql-warehouse-throughput',
      input: 'Write SQL for throughput by warehouse shift with average processing time.',
      groundTruth: 'SQL grouped by shift with processed count and average processing time.',
    },
    {
      id: 'perf-sql-inventory-risk',
      input: 'Write SQL to rank categories at risk of stockout in the next 14 days.',
      groundTruth: 'SQL ranking categories by projected stockout risk.',
    },
    {
      id: 'perf-sql-returns-rate',
      input: 'Generate SQL for return rate by product category in the last 90 days.',
      groundTruth: 'SQL grouped by category with return rate calculation over last 90 days.',
    },
    {
      id: 'perf-sql-arpu',
      input: 'Write SQL to calculate monthly ARPU for paying customers.',
      groundTruth: 'SQL computing monthly revenue divided by distinct paying users.',
    },
    {
      id: 'perf-sql-customer-ltv',
      input: 'Write SQL to estimate customer lifetime value by acquisition channel.',
      groundTruth: 'SQL aggregating customer revenue and grouping by acquisition channel.',
    },
  ],
});

await latencyTokenDataset.push();

