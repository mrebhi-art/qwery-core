/**
 * Mustache Token Optimization — single-turn dataset
 *
 * Focused dataset to validate whether Mustache templating reduced token usage
 * in chart-generation flows.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/single-turn/mustache-token-optimization.dataset.ts
 */

import { EvalDataset } from '@qwery/tracing-sdk/eval';

export const mustacheTokenOptimizationDataset = new EvalDataset({
  name: 'mustache-token-optimization',
  description:
    'Row-heavy chart prompt optimization matrix for before/after token, latency, and quality comparison of Mustache templating',
  goldens: [
    {
      id: 'mustache-small-bar-region-revenue',
      input:
        'Using the available sales data, create a chart-ready answer for total revenue by region and include a concise explanation.',
      groundTruth: 'Chart-ready output for region-level revenue aggregation.',
      metadata: {
        scenario: 'small_bar_region_revenue',
        sizeBucket: 'small',
        chartIntent: 'bar',
      },
    },
    {
      id: 'mustache-medium-bar-region-revenue',
      input:
        'Create a chart-ready summary for total revenue by region, keeping the answer compact and comparison-oriented.',
      groundTruth: 'Chart-ready output for region-level revenue aggregation.',
      metadata: {
        scenario: 'medium_bar_region_revenue',
        sizeBucket: 'medium',
        chartIntent: 'bar',
      },
    },
    {
      id: 'mustache-large-bar-region-revenue',
      input:
        'Prepare a bar-chart-style response for total revenue by region using a larger result set without overexplaining.',
      groundTruth: 'Chart-ready output for region-level revenue aggregation.',
      metadata: {
        scenario: 'large_bar_region_revenue',
        sizeBucket: 'large',
        chartIntent: 'bar',
      },
    },
    {
      id: 'mustache-small-line-monthly-trend',
      input:
        'Generate a month-over-month sales trend view from the sales dataset and keep the answer compact.',
      groundTruth: 'Chart-ready monthly trend using month and revenue fields.',
      metadata: {
        scenario: 'small_line_monthly_trend',
        sizeBucket: 'small',
        chartIntent: 'line',
      },
    },
    {
      id: 'mustache-medium-line-monthly-trend',
      input:
        'Generate a month-over-month sales trend view from the sales dataset with enough structure for a line chart.',
      groundTruth: 'Chart-ready monthly trend using month and revenue fields.',
      metadata: {
        scenario: 'medium_line_monthly_trend',
        sizeBucket: 'medium',
        chartIntent: 'line',
      },
    },
    {
      id: 'mustache-large-line-monthly-trend',
      input:
        'Prepare a compact time-series answer for month-over-month revenue trend from a large analytics result.',
      groundTruth: 'Chart-ready monthly trend using month and revenue fields.',
      metadata: {
        scenario: 'large_line_monthly_trend',
        sizeBucket: 'large',
        chartIntent: 'line',
      },
    },
    {
      id: 'mustache-small-pie-regional-share',
      input:
        'Prepare a part-to-whole style output showing each region contribution to overall revenue.',
      groundTruth: 'Share/distribution-style chart output over regions.',
      metadata: {
        scenario: 'small_pie_regional_share',
        sizeBucket: 'small',
        chartIntent: 'pie',
      },
    },
    {
      id: 'mustache-medium-pie-regional-share',
      input:
        'Generate a compact market-share style response showing how each region contributes to total revenue.',
      groundTruth: 'Share/distribution-style chart output over regions.',
      metadata: {
        scenario: 'medium_pie_regional_share',
        sizeBucket: 'medium',
        chartIntent: 'pie',
      },
    },
    {
      id: 'mustache-large-pie-regional-share',
      input:
        'Return a concise part-to-whole revenue breakdown by region for a large aggregated result set.',
      groundTruth: 'Share/distribution-style chart output over regions.',
      metadata: {
        scenario: 'large_pie_regional_share',
        sizeBucket: 'large',
        chartIntent: 'pie',
      },
    },
    {
      id: 'mustache-small-combined-breakdown',
      input:
        'Produce a compact analytics response combining region and month perspectives for revenue in chart-consumable form.',
      groundTruth: 'Compact chart-consumable combined revenue breakdown.',
      metadata: {
        scenario: 'small_combined_breakdown',
        sizeBucket: 'small',
        chartIntent: 'mixed',
      },
    },
    {
      id: 'mustache-medium-combined-breakdown',
      input:
        'Produce a compact analytics response combining region and month perspectives for revenue in chart-consumable form.',
      groundTruth: 'Compact chart-consumable combined revenue breakdown.',
      metadata: {
        scenario: 'medium_combined_breakdown',
        sizeBucket: 'medium',
        chartIntent: 'mixed',
      },
    },
    {
      id: 'mustache-large-combined-breakdown',
      input:
        'Produce a compact analytics response combining region and month perspectives for revenue from a large result set in chart-consumable form.',
      groundTruth: 'Compact chart-consumable combined revenue breakdown.',
      metadata: {
        scenario: 'large_combined_breakdown',
        sizeBucket: 'large',
        chartIntent: 'mixed',
      },
    },
  ],
});

await mustacheTokenOptimizationDataset.push();

