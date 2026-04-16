import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type BirdSingleTurnScriptHarnessParams = {
  dbId: string;
  question: string;
  model: string;
  timeoutMs?: number;
};

type StructuredBirdSingleTurnOutput = {
  answer: string;
  generatedSql?: string;
  sql?: string;
  sqlExecutionTimeMs?: number;
  toolCalls?: ToolCallSummary[];
  agentBehavior?: {
    sqlAttempts: number;
    successfulSqlAttempts: number;
    failedSqlAttempts: number;
    schemaExplorationSteps: number;
    totalToolCalls: number;
    toolUsageEfficiency: number;
    finalSuccess: boolean;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costInCredits?: number;
    model?: string;
  };
};

type RunQueryCall = {
  state: 'output-available' | 'output-error';
  query: string;
  executionTimeMs?: number;
};

type ToolCallSummary = {
  tool: string;
  state?: string;
  query?: string;
  executionTimeMs?: number;
  errorText?: string;
};

const FORCE_KILL_GRACE_MS = Number(
  process.env['EVAL_TIMEOUT_FORCE_KILL_GRACE_MS'] ?? '2500',
);

const PROMPT_TOO_LONG_REGEX = /prompt too long|exceeded max context length/i;

function collectBunEnvFileArgs(packageRoot: string): string[] {
  const candidates = ['.env', '.env.local', '.env.development'];
  const args: string[] = [];

  for (const name of candidates) {
    const path = resolve(packageRoot, name);
    if (existsSync(path)) {
      args.push('--env-file', path);
    }
  }

  return args;
}

function parseAnswer(stdout: string): string {
  const normalized = stdout.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const answerLabelIndex = lines.findIndex((line) => line.trim() === 'answer:');

  if (answerLabelIndex === -1) {
    throw new Error(
      'Could not find "answer:" section in bird-single-turn output.',
    );
  }

  let answerEndIndex = lines.length;
  for (let index = answerLabelIndex + 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === 'usage:') {
      answerEndIndex = index;
      break;
    }
  }

  const answer = lines.slice(answerLabelIndex + 1, answerEndIndex).join('\n').trim();
  if (!answer) {
    throw new Error('bird-single-turn output had an empty answer section.');
  }

  return answer;
}

function decodeJsonStringLiteral(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function parseJsonObjectAfterLabel(
  stdout: string,
  label: string,
): Record<string, unknown> | null {
  const normalized = stdout.replace(/\r\n/g, '\n');
  const lineStartIndex = normalized.lastIndexOf(`\n${label}`);
  const labelIndex =
    lineStartIndex !== -1
      ? lineStartIndex + 1
      : normalized.startsWith(label)
        ? 0
        : -1;
  if (labelIndex === -1) return null;

  const jsonStart = normalized.indexOf('{', labelIndex + label.length);
  if (jsonStart === -1) return null;

  let depth = 0;
  let jsonEnd = -1;
  for (let index = jsonStart; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        jsonEnd = index;
        break;
      }
    }
  }

  if (jsonEnd === -1) return null;

  try {
    const parsed = JSON.parse(
      normalized.slice(jsonStart, jsonEnd + 1),
    ) as Record<string, unknown>;
    return parsed;
  } catch {
    return null;
  }
}

function parseFlowSummaryToolCalls(stdout: string): ToolCallSummary[] {
  const parsed = parseJsonObjectAfterLabel(stdout, 'flow summary:');
  if (!parsed) return [];

  const tools = parsed['tools'];
  if (!Array.isArray(tools)) return [];

  const summary: ToolCallSummary[] = [];
  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    const item = tool as Record<string, unknown>;
    const toolName = item['tool'];
    if (typeof toolName !== 'string' || toolName.length === 0) continue;

    summary.push({
      tool: toolName,
      ...(typeof item['state'] === 'string' ? { state: item['state'] } : {}),
      ...(typeof item['query'] === 'string' ? { query: item['query'] } : {}),
      ...(typeof item['executionTimeMs'] === 'number'
        ? { executionTimeMs: item['executionTimeMs'] }
        : {}),
      ...(typeof item['errorText'] === 'string'
        ? { errorText: item['errorText'] }
        : {}),
    });
  }

  return summary;
}

function parseRunQueryCalls(stdout: string): RunQueryCall[] {
  const normalized = stdout.replace(/\r\n/g, '\n');

  const callRegex =
    /"type"\s*:\s*"tool-runQuery"[\s\S]*?"state"\s*:\s*"(output-available|output-error)"[\s\S]*?"input"\s*:\s*\{[\s\S]*?"query"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]*?(?:"executionTimeMs"\s*:\s*([0-9.]+))?/g;
  const calls: RunQueryCall[] = [];

  for (const match of normalized.matchAll(callRegex)) {
    const stateRaw = match[1];
    const queryRaw = match[2];
    if (!stateRaw || !queryRaw) continue;

    const executionTimeRaw = match[3];
    const executionTimeMs =
      executionTimeRaw && Number.isFinite(Number(executionTimeRaw))
        ? Number(executionTimeRaw)
        : undefined;

    calls.push({
      state: stateRaw as RunQueryCall['state'],
      query: decodeJsonStringLiteral(queryRaw),
      executionTimeMs,
    });
  }

  if (calls.length === 0) {
    const flowSummaryCalls = parseFlowSummaryToolCalls(stdout)
      .filter(
        (call) =>
          call.tool.toLowerCase() === 'runquery' &&
          typeof call.query === 'string' &&
          call.query.trim().length > 0,
      )
      .map((call): RunQueryCall => {
        const state: RunQueryCall['state'] =
          call.state === 'output-error' ? 'output-error' : 'output-available';

        return {
          state,
          query: call.query as string,
          ...(typeof call.executionTimeMs === 'number'
            ? { executionTimeMs: call.executionTimeMs }
            : {}),
        };
      });

    return flowSummaryCalls;
  }

  return calls;
}

function queryLooksLikeSchemaProbe(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return (
    normalized.includes('information_schema') ||
    normalized.includes('sqlite_master') ||
    normalized.startsWith('pragma ') ||
    normalized.startsWith('select column_name from information_schema.columns') ||
    /^select\s+\*\s+from\s+[a-z0-9_\.\"]+\s+limit\s+\d+\s*;?$/i.test(query)
  );
}

function scoreRunQueryCall(call: RunQueryCall, question?: string): number {
  const query = call.query;
  const queryLower = query.toLowerCase();
  const questionLower = question?.toLowerCase() ?? '';

  let score = 0;

  score += call.state === 'output-available' ? 4 : -2;

  if (queryLooksLikeSchemaProbe(query)) {
    score -= 6;
  }

  if (/\bjoin\b/i.test(query)) score += 1;
  if (/\bwhere\b/i.test(query)) score += 0.5;
  if (/\bgroup\s+by\b|\bhaving\b|\bover\s*\(/i.test(query)) score += 1.5;
  if (/\border\s+by\b/i.test(query)) score += 0.75;
  if (/\blimit\b|\boffset\b/i.test(query)) score += 0.5;
  if (/\bcount\s*\(/i.test(query)) score += 0.5;
  if (/\bavg\s*\(/i.test(query)) score += 0.5;
  if (/\bdistinct\b/i.test(query)) score += 0.4;

  if (/\baverage\b|\bavg\b|\bmean\b/i.test(questionLower)) {
    score += /\bavg\s*\(/i.test(query) ? 2 : -0.5;
  }

  if (/\bhow many\b|\bnumber of\b|\bcount\b/i.test(questionLower)) {
    score += /\bcount\s*\(/i.test(query) ? 1.75 : 0;
  }

  if (/\btop\b|\bhighest\b|\blowest\b|\brank\b|\b\d+(st|nd|rd|th)\b/i.test(questionLower)) {
    score += /\border\s+by\b|\brank\s*\(|\brow_number\s*\(|\blimit\b|\boffset\b/i.test(
      query,
    )
      ? 1.5
      : 0;
  }

  // Favor richer analytical SQL over short verification checks.
  const queryLengthBonus = Math.min(1.5, query.length / 350);
  score += queryLengthBonus;

  return score;
}

function pickGeneratedSqlCall(stdout: string, question?: string): RunQueryCall | null {
  const calls = parseRunQueryCalls(stdout);
  if (calls.length === 0) return null;

  const scored = calls.map((call, index) => ({
    call,
    index,
    score: scoreRunQueryCall(call, question),
  }));

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.call.query.length !== left.call.query.length) {
      return right.call.query.length - left.call.query.length;
    }
    return left.index - right.index;
  });

  const best = scored[0];
  if (best) {
    return best.call;
  }

  return calls[calls.length - 1] ?? null;
}

function parseUsage(stdout: string): StructuredBirdSingleTurnOutput['usage'] | undefined {
  const parsed = parseJsonObjectAfterLabel(stdout, 'usage:');
  if (!parsed) return undefined;

  return {
    ...(typeof parsed['inputTokens'] === 'number'
      ? { inputTokens: parsed['inputTokens'] }
      : {}),
    ...(typeof parsed['outputTokens'] === 'number'
      ? { outputTokens: parsed['outputTokens'] }
      : {}),
    ...(typeof parsed['totalTokens'] === 'number'
      ? { totalTokens: parsed['totalTokens'] }
      : {}),
    ...(typeof parsed['costInCredits'] === 'number'
      ? { costInCredits: parsed['costInCredits'] }
      : {}),
    ...(typeof parsed['model'] === 'string' ? { model: parsed['model'] } : {}),
  };
}

function parseRunQueryPerfMs(stdout: string): number | undefined {
  const perfRegex = /runQueryV2 TOTAL took\s+([0-9.]+)ms/gi;
  let lastMs: number | undefined;
  for (const match of stdout.matchAll(perfRegex)) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      lastMs = value;
    }
  }
  return lastMs;
}

function parseToolCallNames(stdout: string): string[] {
  const names: string[] = [];
  const regex = /"type"\s*:\s*"tool-([a-zA-Z0-9_]+)"/g;
  for (const match of stdout.matchAll(regex)) {
    if (match[1]) {
      names.push(match[1]);
    }
  }

  if (names.length === 0) {
    for (const call of parseFlowSummaryToolCalls(stdout)) {
      names.push(call.tool);
    }
  }

  return names;
}

function collectToolCallDiagnostics(stdout: string): ToolCallSummary[] {
  const fromFlowSummary = parseFlowSummaryToolCalls(stdout);
  if (fromFlowSummary.length > 0) return fromFlowSummary;

  const runQueryCalls = parseRunQueryCalls(stdout).map((call) => ({
    tool: 'runQuery',
    state: call.state,
    query: call.query,
    ...(typeof call.executionTimeMs === 'number'
      ? { executionTimeMs: call.executionTimeMs }
      : {}),
  }));
  if (runQueryCalls.length > 0) return runQueryCalls;

  const names = parseToolCallNames(stdout);
  return names.map((name) => ({ tool: name }));
}

function buildConciseFailureMessage(params: {
  header: string;
  stdout: string;
  stderr: string;
  question?: string;
}): string {
  const { header, stdout, stderr, question } = params;
  const toolCalls = collectToolCallDiagnostics(stdout);
  const extractedSql = pickGeneratedSqlCall(stdout, question)?.query;

  let answer: string | undefined;
  try {
    answer = parseAnswer(stdout);
  } catch {
    answer = undefined;
  }

  const lines: string[] = [header];

  if (answer && answer.trim().length > 0) {
    lines.push('returned:');
    lines.push(answer.trim());
  }

  if (toolCalls.length > 0) {
    lines.push('tool_calls:');
    lines.push(JSON.stringify(toolCalls, null, 2));
  }

  if (typeof extractedSql === 'string' && extractedSql.trim().length > 0) {
    lines.push('extracted_sql:');
    lines.push(extractedSql.trim());
  }

  if (stderr.trim().length > 0) {
    lines.push('stderr:');
    lines.push(stderr.trim());
  }

  return lines.join('\n');
}

function parseAgentBehavior(
  stdout: string,
  hasAnswer: boolean,
  hasGeneratedSql: boolean,
): StructuredBirdSingleTurnOutput['agentBehavior'] {
  const runQueryCalls = parseRunQueryCalls(stdout);
  const toolCallNames = parseToolCallNames(stdout);

  const sqlAttempts = runQueryCalls.length;
  const successfulSqlAttempts = runQueryCalls.filter(
    (call) => call.state === 'output-available',
  ).length;
  const failedSqlAttempts = Math.max(0, sqlAttempts - successfulSqlAttempts);
  const schemaExplorationSteps = toolCallNames.filter(
    (name) => name.toLowerCase() === 'getschema',
  ).length;
  const totalToolCalls = toolCallNames.length;
  const effectiveCalls = successfulSqlAttempts + Math.max(0, schemaExplorationSteps - 1);
  const toolUsageEfficiency =
    totalToolCalls > 0
      ? Math.max(0, Math.min(1, effectiveCalls / totalToolCalls))
      : hasGeneratedSql
        ? 1
        : 0;

  return {
    sqlAttempts,
    successfulSqlAttempts,
    failedSqlAttempts,
    schemaExplorationSteps,
    totalToolCalls,
    toolUsageEfficiency,
    finalSuccess: hasAnswer && hasGeneratedSql,
  };
}

function shouldRetryForPromptTooLong(message: string): boolean {
  return PROMPT_TOO_LONG_REGEX.test(message);
}

function shouldRetryForTimeout(message: string): boolean {
  return /timed out after\s+\d+ms/i.test(message);
}

export async function runBirdSingleTurnScriptHarness({
  dbId,
  question,
  model,
  timeoutMs = Number(process.env['EVAL_CASE_TIMEOUT_MS'] ?? '120000'),
}: BirdSingleTurnScriptHarnessParams): Promise<string> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(currentDir, '..', '..', '..');
  const scriptPath = resolve(packageRoot, 'scripts', 'internal-agent', 'bird-single-turn.ts');
  const bunArgs = [...collectBunEnvFileArgs(packageRoot), scriptPath];

  const configuredBaseMaxSteps =
    process.env['EVAL_BIRD_MAX_STEPS'] ??
    process.env['MAX_STEPS'] ??
    process.env['QWERY_MAX_STEPS'] ??
    '8';

  const retryMaxStepsRaw = Number.parseInt(
    process.env['EVAL_BIRD_RETRY_MAX_STEPS'] ?? '6',
    10,
  );
  const retryMaxSteps =
    Number.isFinite(retryMaxStepsRaw) && retryMaxStepsRaw > 0
      ? String(retryMaxStepsRaw)
      : '6';

  const promptRetryCountRaw = Number.parseInt(
    process.env['EVAL_PROMPT_TOO_LONG_RETRIES'] ?? '1',
    10,
  );
  const promptTooLongRetries =
    Number.isFinite(promptRetryCountRaw) && promptRetryCountRaw >= 0
      ? promptRetryCountRaw
      : 1;

  const timeoutRetryCountRaw = Number.parseInt(
    process.env['EVAL_TIMEOUT_RETRIES'] ?? '1',
    10,
  );
  const timeoutRetries =
    Number.isFinite(timeoutRetryCountRaw) && timeoutRetryCountRaw >= 0
      ? timeoutRetryCountRaw
      : 1;

  const runAttempt = async (params: {
    attempt: number;
    maxSteps: string;
  }): Promise<string> => {
    const { attempt, maxSteps } = params;

    return await new Promise<string>((resolveAnswer, reject) => {
      const startedAtMs = Date.now();
      const child = spawn('bun', bunArgs, {
        cwd: packageRoot,
        env: {
          ...process.env,
          MODEL: model,
          FLOW_MODE: process.env['BIRD_FLOW_MODE'] ?? 'compact',
          MAX_STEPS: maxSteps,
          QWERY_MAX_STEPS: maxSteps,
          BIRD_DB_ID: dbId,
          BIRD_QUESTION: question,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      let firstStdoutAtMs: number | null = null;
      let lastStdoutAtMs: number | null = null;
      let answerSeenAtMs: number | null = null;

      let forceKillTimer: NodeJS.Timeout | null = null;

      const clearTimers = (): void => {
        clearTimeout(timeout);
        if (forceKillTimer) {
          clearTimeout(forceKillTimer);
          forceKillTimer = null;
        }
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;

        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore signal failures and continue with force-kill fallback.
        }

        const graceMs =
          Number.isFinite(FORCE_KILL_GRACE_MS) && FORCE_KILL_GRACE_MS > 0
            ? FORCE_KILL_GRACE_MS
            : 2500;

        forceKillTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Child may already be gone.
          }
        }, graceMs);

        const elapsedMs = Date.now() - startedAtMs;
        reject(
          new Error(
            buildConciseFailureMessage({
              header:
                `bird-single-turn timed out after ${timeoutMs}ms for dbId=${dbId} ` +
                `(attempt=${attempt + 1}, elapsed=${elapsedMs}ms, answer_seen=${
                  answerSeenAtMs !== null
                }, first_stdout_ms=${
                  firstStdoutAtMs !== null ? firstStdoutAtMs - startedAtMs : 'n/a'
                }, last_stdout_ms=${
                  lastStdoutAtMs !== null ? lastStdoutAtMs - startedAtMs : 'n/a'
                }).`,
              stdout,
              stderr,
              question,
            }),
          ),
        );
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        const now = Date.now();

        if (firstStdoutAtMs === null) {
          firstStdoutAtMs = now;
        }
        lastStdoutAtMs = now;

        if (answerSeenAtMs === null && stdout.includes('\nanswer:')) {
          answerSeenAtMs = now;
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimers();

        if (code !== 0) {
          reject(
            new Error(
              buildConciseFailureMessage({
                header: `bird-single-turn exited with code ${code} for dbId=${dbId} (attempt=${attempt + 1}).`,
                stdout,
                stderr,
                question,
              }),
            ),
          );
          return;
        }

        try {
          const answer = parseAnswer(stdout);
          const generatedSqlCall = pickGeneratedSqlCall(stdout, question);
          const generatedSql = generatedSqlCall?.query;
          const sqlExecutionTimeMs =
            generatedSqlCall?.executionTimeMs ?? parseRunQueryPerfMs(stdout);
          const usage = parseUsage(stdout);
          const toolCalls = collectToolCallDiagnostics(stdout);
          const agentBehavior = parseAgentBehavior(
            stdout,
            answer.length > 0,
            typeof generatedSql === 'string' && generatedSql.trim().length > 0,
          );
          const payload: StructuredBirdSingleTurnOutput = {
            answer,
            ...(generatedSql ? { generatedSql, sql: generatedSql } : {}),
            ...(typeof sqlExecutionTimeMs === 'number' ? { sqlExecutionTimeMs } : {}),
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
            ...(agentBehavior ? { agentBehavior } : {}),
            ...(usage ? { usage } : {}),
          };
          resolveAnswer(JSON.stringify(payload));
        } catch (error) {
          reject(
            new Error(
              `Failed to parse bird-single-turn answer for dbId=${dbId}: ${
                error instanceof Error ? error.message : String(error)
              }\nstdout:\n${stdout}`,
            ),
          );
        }
      });
    });
  };

  const maxRetryBudget = Math.max(promptTooLongRetries, timeoutRetries);

  let lastError: Error | null = null;
  let usedPromptRetries = 0;
  let usedTimeoutRetries = 0;

  for (let attempt = 0; attempt <= maxRetryBudget; attempt += 1) {
    const maxStepsForAttempt = attempt === 0 ? configuredBaseMaxSteps : retryMaxSteps;

    try {
      return await runAttempt({
        attempt,
        maxSteps: maxStepsForAttempt,
      });
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      lastError = normalizedError;

      const isPromptTooLongError = shouldRetryForPromptTooLong(normalizedError.message);
      const isTimeoutError = shouldRetryForTimeout(normalizedError.message);

      const canRetryPrompt =
        isPromptTooLongError && usedPromptRetries < promptTooLongRetries;
      const canRetryTimeout = isTimeoutError && usedTimeoutRetries < timeoutRetries;

      const shouldRetry = canRetryPrompt || canRetryTimeout;

      if (!shouldRetry) {
        throw normalizedError;
      }

      if (canRetryPrompt) {
        usedPromptRetries += 1;
      }

      if (canRetryTimeout) {
        usedTimeoutRetries += 1;
      }
    }
  }

  throw (
    lastError ??
    new Error(`bird-single-turn failed for dbId=${dbId} without detailed error.`)
  );
}
