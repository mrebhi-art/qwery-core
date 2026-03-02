import { generateObject } from 'ai';
import { resolveModel, getDefaultModel } from '../../services';
import {
  ChartTypeSelectionSchema,
  ChartConfigSchema,
  ChartConfigTemplateSchema,
  type ChartType,
  type ChartConfigTemplate,
} from '../types/chart.types';
import { SELECT_CHART_TYPE_PROMPT } from '../prompts/select-chart-type.prompt';
import { GENERATE_CHART_CONFIG_PROMPT } from '../prompts/generate-chart-config.prompt';
import { getSupportedChartTypes } from '../config/supported-charts';
import { getLogger } from '@qwery/shared/logger';

export interface QueryResults {
  rows: Array<Record<string, unknown>>;
  columns: string[];
}

export interface GenerateChartInput {
  queryResults: QueryResults;
  sqlQuery: string;
  userInput: string;
  chartType?: ChartType; // Optional: if provided, skip selection step
}

/**
 * Step 1: Select the best chart type based on data analysis
 */
export async function selectChartType(
  queryResults: QueryResults,
  sqlQuery: string,
  userInput: string,
): Promise<{ chartType: ChartType; reasoningText: string }> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(new Error('Chart type selection timeout after 30 seconds')),
        30000,
      );
    });

    const generatePromise = generateObject({
      model: await resolveModel(getDefaultModel()),
      schema: ChartTypeSelectionSchema,
      prompt: SELECT_CHART_TYPE_PROMPT(userInput, sqlQuery, queryResults),
    });

    const result = await Promise.race([generatePromise, timeoutPromise]);
    return result.object;
  } catch (error) {
    const logger = await getLogger();
    logger.error('[selectChartType] ERROR:', error);
    // Fallback to first supported chart type if selection fails
    const supportedTypes = getSupportedChartTypes();
    const fallbackType = supportedTypes[0] || 'bar';
    return {
      chartType: fallbackType,
      reasoningText: `Failed to analyze chart type, defaulting to ${fallbackType} chart`,
    };
  }
}

/**
 * Step 2: Generate chart configuration JSON
 */
export async function generateChartConfig(
  chartType: ChartType,
  queryResults: QueryResults,
  sqlQuery: string,
): Promise<{
  chartType: ChartType;
  data: Array<Record<string, unknown>>;
  config: {
    colors: string[];
    labels?: Record<string, string>;
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  };
}> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(new Error('Chart config generation timeout after 30 seconds')),
        30000,
      );
    });

    const generatePromise = generateObject({
      model: await resolveModel(getDefaultModel()),
      schema: ChartConfigTemplateSchema,
      prompt: GENERATE_CHART_CONFIG_PROMPT(chartType, queryResults, sqlQuery),
    });

    const result = await Promise.race([generatePromise, timeoutPromise]);
    const template = result.object as ChartConfigTemplate;

    const data = buildChartData(chartType, queryResults, template.config);

    const chartConfig = ChartConfigSchema.parse({
      chartType: template.chartType,
      title: template.title,
      data,
      config: template.config,
    });

    return chartConfig;
  } catch (error) {
    const logger = await getLogger();
    logger.error('[generateChartConfig] ERROR:', error);
    throw new Error(
      `Failed to generate chart configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function guessCategoryKey(columns: string[]): string | undefined {
  return (
    columns.find((key) => {
      const lower = key.toLowerCase();
      return (
        lower.includes('name') ||
        lower.includes('category') ||
        lower.includes('label')
      );
    }) ?? columns[0]
  );
}

function guessValueKey(
  columns: string[],
  excludeKey?: string,
): string | undefined {
  return (
    columns.find((key) => {
      if (excludeKey && key === excludeKey) return false;
      const lower = key.toLowerCase();
      return (
        lower.includes('value') ||
        lower.includes('count') ||
        lower.includes('amount')
      );
    }) ??
    columns.find((key) => key !== excludeKey) ??
    columns[0]
  );
}

function buildChartData(
  chartType: ChartType,
  queryResults: QueryResults,
  config: {
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  },
): Array<Record<string, unknown>> {
  const { rows, columns } = queryResults;
  if (!rows || rows.length === 0) {
    return [];
  }

  if (chartType === 'bar' || chartType === 'line') {
    let xKey = config.xKey;
    let yKey = config.yKey;

    if (!xKey || !yKey) {
      const guessedX = guessCategoryKey(columns);
      const guessedY = guessValueKey(columns, guessedX);
      xKey = xKey ?? guessedX;
      yKey = yKey ?? guessedY;
    }

    if (!xKey || !yKey) {
      return [];
    }

    return rows.map((row) => {
      const record: Record<string, unknown> = {};
      const typedRow = row as Record<string, unknown>;
      record[xKey] = typedRow[xKey];
      record[yKey] = typedRow[yKey];
      return record;
    });
  }

  if (chartType === 'pie') {
    let nameKey = config.nameKey;
    let valueKey = config.valueKey;

    if (!nameKey || !valueKey) {
      const guessedName = guessCategoryKey(columns);
      const guessedValue = guessValueKey(columns, guessedName);
      nameKey = nameKey ?? guessedName;
      valueKey = valueKey ?? guessedValue;
    }

    if (!nameKey || !valueKey) {
      return [];
    }

    return rows.map((row) => {
      const record: Record<string, unknown> = {};
      const typedRow = row as Record<string, unknown>;
      record[nameKey as string] = typedRow[nameKey];
      record[valueKey as string] = typedRow[valueKey];
      return record;
    });
  }

  return [];
}

/**
 * Main function: Generate chart from query results
 * This is the entry point called by the generateChart tool
 */
export async function generateChart(input: GenerateChartInput): Promise<{
  chartType: ChartType;
  data: Array<Record<string, unknown>>;
  config: {
    colors: string[];
    labels?: Record<string, string>;
    xKey?: string;
    yKey?: string;
    nameKey?: string;
    valueKey?: string;
  };
}> {
  // Step 1: Always select chart type to get reasoning for UI
  // Even if chartType is provided, we still call selectChartType to get the reasoning
  // This ensures the UI always has the selection data to display
  const selection = await selectChartType(
    input.queryResults,
    input.sqlQuery,
    input.userInput,
  );
  const chartType = input.chartType || selection.chartType;

  // Step 2: Generate chart configuration
  const chartConfig = await generateChartConfig(
    chartType,
    input.queryResults,
    input.sqlQuery,
  );

  const [firstRow] = chartConfig.data;
  if (firstRow && typeof firstRow === 'object') {
    const availableKeys = Object.keys(firstRow);
    if (chartType === 'bar' || chartType === 'line') {
      const xKey = chartConfig.config.xKey ?? 'name';
      const yKey = chartConfig.config.yKey ?? 'value';
      const hasXKey = availableKeys.includes(xKey);
      const hasYKey = availableKeys.includes(yKey);
      if (!hasXKey || !hasYKey) {
        const altXKey =
          availableKeys.find((key) => {
            const lower = key.toLowerCase();
            return (
              lower.includes('name') ||
              lower.includes('category') ||
              lower.includes('label')
            );
          }) ?? availableKeys[0];
        const altYKey =
          availableKeys.find((key) => {
            const lower = key.toLowerCase();
            return (
              lower.includes('value') ||
              lower.includes('count') ||
              lower.includes('amount')
            );
          }) ??
          availableKeys[1] ??
          availableKeys[0];
        if (altXKey && altYKey && altXKey !== altYKey) {
          chartConfig.config.xKey = chartConfig.config.xKey || altXKey;
          chartConfig.config.yKey = chartConfig.config.yKey || altYKey;
        }
      }
    }
    if (chartType === 'pie') {
      const nameKey = chartConfig.config.nameKey ?? 'name';
      const valueKey = chartConfig.config.valueKey ?? 'value';
      const hasNameKey = availableKeys.includes(nameKey);
      const hasValueKey = availableKeys.includes(valueKey);
      if (!hasNameKey || !hasValueKey) {
        const altNameKey =
          availableKeys.find((key) => {
            const lower = key.toLowerCase();
            return (
              lower.includes('name') ||
              lower.includes('category') ||
              lower.includes('label')
            );
          }) ?? availableKeys[0];
        const altValueKey =
          availableKeys.find((key) => {
            const lower = key.toLowerCase();
            return (
              lower.includes('value') ||
              lower.includes('count') ||
              lower.includes('amount')
            );
          }) ??
          availableKeys[1] ??
          availableKeys[0];
        if (altNameKey && altValueKey && altNameKey !== altValueKey) {
          chartConfig.config.nameKey = chartConfig.config.nameKey || altNameKey;
          chartConfig.config.valueKey =
            chartConfig.config.valueKey || altValueKey;
        }
      }
    }
  }

  return chartConfig;
}
