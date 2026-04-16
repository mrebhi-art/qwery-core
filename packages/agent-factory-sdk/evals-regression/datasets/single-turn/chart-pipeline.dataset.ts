/**
 * Chart Pipeline — single-turn dataset
 *
 * Evaluates the chart pipeline directly:
 * 1. chart type selection
 * 2. chart config generation
 * 3. chart data transformation
 * 4. SVG rendering
 */

import { EvalDataset } from '@qwery/tracing-sdk/eval';

type ChartPipelineSpec = {
  selectedChartType: 'bar' | 'line' | 'pie';
  finalChartType: 'bar' | 'line' | 'pie';
  config: {
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  };
  labels?: Record<string, string>;
  expectedData: Array<Record<string, unknown>>;
  svgMustContain?: string[];
};

function spec(value: ChartPipelineSpec): string {
  return JSON.stringify(value);
}

export const chartPipelineDataset = new EvalDataset({
  name: 'chart-pipeline-evals',
  description:
    'Direct chart pipeline tests for chart type selection, config params, transformed data, and rendered SVG',
  goldens: [
    {
      id: 'pipeline-bar-sales-by-region',
      input: 'Show total sales by region as a bar chart.',
      groundTruth: spec({
        selectedChartType: 'bar',
        finalChartType: 'bar',
        config: { xKey: 'region', yKey: 'total_sales' },
        labels: { region: 'Region', total_sales: 'Total Sales' },
        expectedData: [
          { region: 'North', total_sales: 124000 },
          { region: 'South', total_sales: 118000 },
          { region: 'East', total_sales: 97000 },
          { region: 'West', total_sales: 136000 },
        ],
        svgMustContain: ['North', 'South', 'East', 'West', 'Region', 'Total Sales'],
      }),
      metadata: {
        scenario: 'sales_by_region',
        evalKind: 'chart_pipeline',
      },
    },
    {
      id: 'pipeline-line-monthly-revenue',
      input: 'Show the monthly revenue trend as a line chart.',
      groundTruth: spec({
        selectedChartType: 'line',
        finalChartType: 'line',
        config: { xKey: 'month', yKey: 'total_revenue' },
        labels: { month: 'Month', total_revenue: 'Total Revenue' },
        expectedData: [
          { month: '2024-01', total_revenue: 54000 },
          { month: '2024-02', total_revenue: 51000 },
          { month: '2024-03', total_revenue: 60000 },
          { month: '2024-04', total_revenue: 65000 },
        ],
        svgMustContain: ['2024-01', '2024-04', 'Month', 'Total Revenue'],
      }),
      metadata: {
        scenario: 'monthly_revenue',
        evalKind: 'chart_pipeline',
      },
    },
    {
      id: 'pipeline-pie-market-share',
      input: 'Visualize market share by company as a pie chart.',
      groundTruth: spec({
        selectedChartType: 'pie',
        finalChartType: 'pie',
        config: { nameKey: 'company', valueKey: 'share_pct' },
        labels: { company: 'Company', share_pct: 'Share %' },
        expectedData: [
          { company: 'Apple', share_pct: 45 },
          { company: 'Samsung', share_pct: 30 },
          { company: 'Google', share_pct: 15 },
          { company: 'Others', share_pct: 10 },
        ],
        svgMustContain: ['Apple', 'Samsung', 'Google', 'Others'],
      }),
      metadata: {
        scenario: 'market_share',
        evalKind: 'chart_pipeline',
      },
    },
    {
      id: 'pipeline-bar-orders-by-category',
      input: 'Compare order count by product category in a bar chart.',
      groundTruth: spec({
        selectedChartType: 'bar',
        finalChartType: 'bar',
        config: { xKey: 'product_category', yKey: 'order_count' },
        labels: {
          product_category: 'Product Category',
          order_count: 'Order Count',
        },
        expectedData: [
          { product_category: 'Electronics', order_count: 42 },
          { product_category: 'Furniture', order_count: 28 },
          { product_category: 'Office Supplies', order_count: 35 },
        ],
        svgMustContain: ['Electronics', 'Furniture', 'Office Supplies', 'Order Count'],
      }),
      metadata: {
        scenario: 'orders_by_category',
        evalKind: 'chart_pipeline',
      },
    },
    {
      id: 'pipeline-line-daily-signups',
      input: 'Show the daily signup trend as a line chart.',
      groundTruth: spec({
        selectedChartType: 'line',
        finalChartType: 'line',
        config: { xKey: 'day', yKey: 'signup_count' },
        labels: { day: 'Day', signup_count: 'Signup Count' },
        expectedData: [
          { day: '2026-04-01', signup_count: 12 },
          { day: '2026-04-02', signup_count: 18 },
          { day: '2026-04-03', signup_count: 15 },
          { day: '2026-04-04', signup_count: 24 },
          { day: '2026-04-05', signup_count: 21 },
        ],
        svgMustContain: ['2026-04-01', '2026-04-05', 'Day', 'Signup Count'],
      }),
      metadata: {
        scenario: 'daily_signups',
        evalKind: 'chart_pipeline',
      },
    },
    {
      id: 'pipeline-pie-expense-breakdown',
      input: 'Create a pie chart showing the expense breakdown by category.',
      groundTruth: spec({
        selectedChartType: 'pie',
        finalChartType: 'pie',
        config: { nameKey: 'category', valueKey: 'amount' },
        labels: { category: 'Category', amount: 'Amount' },
        expectedData: [
          { category: 'Rent', amount: 3200 },
          { category: 'Payroll', amount: 5400 },
          { category: 'Marketing', amount: 1800 },
          { category: 'Software', amount: 900 },
        ],
        svgMustContain: ['Rent', 'Payroll', 'Marketing', 'Software'],
      }),
      metadata: {
        scenario: 'expense_breakdown',
        evalKind: 'chart_pipeline',
      },
    },
  ],
});

await chartPipelineDataset.push();
