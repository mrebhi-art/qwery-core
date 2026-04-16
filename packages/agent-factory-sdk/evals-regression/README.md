# Evals Regression Suites

This folder contains script-based regression eval suites for `@qwery/agent-factory-sdk`.

The multi-turn suites use `evalConversation(...)` from `@qwery/tracing-sdk/eval`,
which evaluates a full conversation (turn sequence), not a single prompt.

## Prerequisites

- `qwery-eval` backend running (default `http://localhost:4097`)
- `qwery-eval-ui` running (default `http://localhost:5090`) for viewing results
- model credentials configured (for example `EVAL_MODEL`, provider API keys)

## Multi-turn Suites

- `multi-turn-ask-evals`
  - Script: `evals-regression/suites/multi-turn-ask-eval-suite.ts`
  - Command:
    - `pnpm --filter @qwery/agent-factory-sdk eval:suite:multi-turn`
- `context-retention-evals`
  - Script: `evals-regression/suites/context-retention-eval-suite.ts`
  - Command:
    - `pnpm --filter @qwery/agent-factory-sdk eval:suite:context-retention`
- `conversation-correction-evals`
  - Script: `evals-regression/suites/conversation-correction-eval-suite.ts`
  - Command:
    - `pnpm --filter @qwery/agent-factory-sdk eval:suite:conv-correction`

## Regression Runner

Use the before/after runner to compare versions:

```bash
node evals-regression/runner.mjs --base HEAD^ --suite multi-turn-ask
node evals-regression/runner.mjs --base HEAD^ --suite context-retention
node evals-regression/runner.mjs --base HEAD^ --suite conv-correction
```

Or run all suites:

```bash
node evals-regression/runner.mjs --base HEAD^ --suite all
```

## Common Environment Variables

- `EVAL_BASE_URL` (default `http://localhost:4097`)
- `EVAL_UI_BASE_URL` (default `http://localhost:5090`)
- `EVAL_MODEL` (for example `ollama-cloud/minimax-m2.5`)
- `AGENT_VERSION` (optional explicit version tag for run labeling)
- `EVAL_PROJECT_ID` (optional, scopes eval conversation IDs/traces to a specific project)
- `EVAL_DATASOURCE_ID` (recommended real datasource id to attach during eval)
- `EVAL_REQUIRE_REAL_DATASOURCE=1` (optional strict mode; fails eval when `EVAL_DATASOURCE_ID` is missing)
- `EVAL_SUPPRESS_DS_WARN=1` (optional; suppresses synthetic datasource warning)
