/**
 * Chart Generation — single-turn dataset
 *
 * Tests the Ask agent's ability to render, explain, and recommend chart types.
 *
 * Register to backend:
 *   bun run evals-regression/datasets/single-turn/chart-generation.dataset.ts
 */

import { EvalDataset } from '@qwery/tracing-sdk/eval';

const CHART_TYPE_RE = /\b(bar|pie|line|scatter|area|histogram|donut|heatmap|column)\b/i;

export const chartGenerationDataset = new EvalDataset({
  name: 'chart-generation-evals',
  description: 'Ask agent chart generation, recommendation, and description tests',
  goldens: [
    {
      id: 'chart-bar',
      input: 'Show me sales by region as a bar chart from the sales table.',
      groundTruth: '<svg',
      customMetrics: [
        { name: 'mentions_bar', fn: (out) => /\bbar\b/i.test(out) ? 1 : 0 },
        { name: 'generated_svg', fn: (out) => out.includes('<svg') ? 1 : 0 },
        { name: 'mentions_chart_type', fn: (out) => CHART_TYPE_RE.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'chart-pie',
      input: 'Show me market share by company as a pie chart from the market_share table.',
      groundTruth: '<svg',
      customMetrics: [
        { name: 'mentions_pie', fn: (out) => /\bpie\b/i.test(out) ? 1 : 0 },
        { name: 'generated_svg', fn: (out) => out.includes('<svg') ? 1 : 0 },
        { name: 'mentions_chart_type', fn: (out) => CHART_TYPE_RE.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'chart-sophisticated',
      input:
        'Analyze the sales table. First, tell me which region has the highest revenue, then show me a chart comparing revenue vs target for all regions.',
      groundTruth: 'West',
      customMetrics: [
        { name: 'identifies_highest_region', fn: (out) => /west/i.test(out) ? 1 : 0 },
        { name: 'generated_svg', fn: (out) => out.includes('<svg') ? 1 : 0 },
        { name: 'mentions_target', fn: (out) => /target/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'chart-recommend',
      input: 'What type of chart should I use to compare values across different categories?',
      groundTruth: 'bar',
      customMetrics: [
        { name: 'recommends_bar_or_column', fn: (out) => /\b(bar|column)\b/i.test(out) ? 1 : 0 },
        { name: 'mentions_comparison', fn: (out) => /compar|categor|group/i.test(out) ? 1 : 0 },
      ],
    },
    {
      id: 'chart-histogram',
      input: 'Describe what a histogram is and when I should use it',
      groundTruth: 'distribution',
      customMetrics: [
        { name: 'mentions_distribution', fn: (out) => /distribut|frequency|bucket|bin|range/i.test(out) ? 1 : 0 },
        { name: 'is_substantive', fn: (out) => out.trim().length > 50 ? 1 : 0 },
      ],
    },
  ],
});

await chartGenerationDataset.push();

