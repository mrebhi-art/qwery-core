import { EvalDataset } from '@qwery/tracing-sdk/eval';

type MustacheImpactSpec = {
  selectedChartType: 'bar' | 'line' | 'pie';
  finalChartType: 'bar' | 'line' | 'pie';
  config: {
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  };
  svgMustContain?: string[];
  minDataLength: number;
};

function spec(value: MustacheImpactSpec): string {
  return JSON.stringify(value);
}

export const mustacheImpactExecutionDataset = new EvalDataset({
  name: 'mustache-impact-execution-evals',
  description:
    'Large-result chart execution cases for proving before/after token, output, latency, and chart-quality impact of Mustache + metadata-only prompts',
  goldens: [
    {
      id: 'mustache-exec-bar-small',
      input: 'Show total revenue by region as a bar chart.',
      groundTruth: spec({
        selectedChartType: 'bar',
        finalChartType: 'bar',
        config: { xKey: 'region', yKey: 'total_revenue' },
        svgMustContain: ['Region', 'Total Revenue'],
        minDataLength: 12,
      }),
      metadata: {
        scenario: 'bar_small',
        sizeBucket: 'small',
        evalKind: 'mustache_impact_execution',
      },
    },
    {
      id: 'mustache-exec-bar-large',
      input:
        'Create a bar chart comparing total revenue by region for a very large business dataset.',
      groundTruth: spec({
        selectedChartType: 'bar',
        finalChartType: 'bar',
        config: { xKey: 'region', yKey: 'total_revenue' },
        svgMustContain: ['Region', 'Total Revenue'],
        minDataLength: 1200,
      }),
      metadata: {
        scenario: 'bar_large',
        sizeBucket: 'large',
        evalKind: 'mustache_impact_execution',
      },
    },
    {
      id: 'mustache-exec-line-small',
      input: 'Show the monthly revenue trend as a line chart.',
      groundTruth: spec({
        selectedChartType: 'line',
        finalChartType: 'line',
        config: { xKey: 'month', yKey: 'total_revenue' },
        svgMustContain: ['Month', 'Total Revenue'],
        minDataLength: 18,
      }),
      metadata: {
        scenario: 'line_small',
        sizeBucket: 'small',
        evalKind: 'mustache_impact_execution',
      },
    },
    {
      id: 'mustache-exec-line-large',
      input:
        'Generate a line chart for revenue trend over time using a large analytics result set.',
      groundTruth: spec({
        selectedChartType: 'line',
        finalChartType: 'line',
        config: { xKey: 'month', yKey: 'total_revenue' },
        svgMustContain: ['Month', 'Total Revenue'],
        minDataLength: 1500,
      }),
      metadata: {
        scenario: 'line_large',
        sizeBucket: 'large',
        evalKind: 'mustache_impact_execution',
      },
    },
    {
      id: 'mustache-exec-pie-small',
      input: 'Visualize market share by region as a pie chart.',
      groundTruth: spec({
        selectedChartType: 'pie',
        finalChartType: 'pie',
        config: { nameKey: 'region', valueKey: 'share_pct' },
        svgMustContain: ['North', 'South'],
        minDataLength: 10,
      }),
      metadata: {
        scenario: 'pie_small',
        sizeBucket: 'small',
        evalKind: 'mustache_impact_execution',
      },
    },
    {
      id: 'mustache-exec-pie-large',
      input:
        'Create a pie chart showing regional share contribution for a large portfolio dataset.',
      groundTruth: spec({
        selectedChartType: 'pie',
        finalChartType: 'pie',
        config: { nameKey: 'region', valueKey: 'share_pct' },
        svgMustContain: ['North', 'South'],
        minDataLength: 900,
      }),
      metadata: {
        scenario: 'pie_large',
        sizeBucket: 'large',
        evalKind: 'mustache_impact_execution',
      },
    },
  ],
});

await mustacheImpactExecutionDataset.push();
