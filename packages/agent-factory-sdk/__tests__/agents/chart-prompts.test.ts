import { describe, expect, it } from 'vitest';
import { SELECT_CHART_TYPE_PROMPT } from '../../src/agents/prompts/select-chart-type.prompt';
import { GENERATE_CHART_CONFIG_PROMPT } from '../../src/agents/prompts/generate-chart-config.prompt';
import type { ChartType } from '../../src/agents/types/chart.types';

const basicQueryResults = {
  columns: ['name', 'value'],
  rows: [
    { name: 'A', value: 1 },
    { name: 'B', value: 2 },
  ] as Array<Record<string, unknown>>,
};

describe('chart prompts with Mustache templates', () => {
  it('renders select chart type prompt without unresolved placeholders', () => {
    const prompt = SELECT_CHART_TYPE_PROMPT(
      'show distribution',
      'select name, value from table',
      basicQueryResults,
      null,
    );

    expect(prompt).toContain('You are a Chart Type Selection Agent');
    expect(prompt).toContain('Available chart types:');
    expect(prompt).toContain('Output Format:');
    expect(prompt).toContain('"chartType":');
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('}}');
    expect(prompt).not.toContain('"A"');
    expect(prompt).not.toContain('"B"');
  });

  it('renders generate chart config prompt without unresolved placeholders', () => {
    const chartType: ChartType = 'bar';
    const prompt = GENERATE_CHART_CONFIG_PROMPT(
      chartType,
      basicQueryResults,
      'select name, value from table',
      null,
    );

    expect(prompt).toContain('You are a Chart Configuration Generator.');
    expect(prompt).toContain('Output Format (strict JSON):');
    expect(prompt).toContain('"chartType": "bar"');
    expect(prompt).toContain('"colors": string[]');
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('}}');
    expect(prompt).not.toContain('"A"');
    expect(prompt).not.toContain('"B"');
  });

  it('handles empty results without embedding rows', () => {
    const emptyResults = {
      columns: ['name', 'value'],
      rows: [] as Array<Record<string, unknown>>,
    };

    const selectPrompt = SELECT_CHART_TYPE_PROMPT(
      'show distribution',
      'select name, value from table',
      emptyResults,
      null,
    );
    const chartType: ChartType = 'bar';
    const configPrompt = GENERATE_CHART_CONFIG_PROMPT(
      chartType,
      emptyResults,
      'select name, value from table',
      null,
    );

    expect(selectPrompt).toContain('Total rows: 0');
    expect(configPrompt).toContain('Total rows: 0');
    expect(selectPrompt).not.toContain('{{');
    expect(selectPrompt).not.toContain('}}');
    expect(configPrompt).not.toContain('{{');
    expect(configPrompt).not.toContain('}}');
  });
});
