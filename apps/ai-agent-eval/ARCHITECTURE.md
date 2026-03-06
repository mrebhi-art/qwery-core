# AI Agent Eval — Service Documentation

## Table of Contents

1. [Tracing](#1-tracing)
2. [Dashboard](#2-dashboard)
3. [Evaluation](#3-evaluation)
4. [Frontend](#4-frontend)

---

## 1. Tracing

### What it does

Tracing captures everything that happens during a single agent turn: which LLM calls were made, which tools ran, what was retrieved, how long each step took, and what artifacts (SQL, charts, tables) were produced. This data is what the Dashboard visualizes and what the Evaluation service scores.

---

### How tracing actually works

There is a dedicated SDK — `packages/tracing-sdk` — that the agent imports. The agent never talks to the Tracing HTTP service directly. Instead it uses the SDK, which handles batching, retries, and fire-and-forget delivery in the background so that tracing never slows down or breaks the agent.

#### Step 1 — Configure the SDK

The agent creates one `TracingSdk` instance at startup, pointing at the tracing backend:

```typescript
import { TracingSdk } from '@qwery/tracing-sdk';

const sdk = new TracingSdk({
  baseUrl: 'http://localhost:4097',
  apiKey: 'my-api-key',
  failSilently: true,   // tracing errors never crash the agent
  flushIntervalMs: 2000,
  maxQueueSize: 50,
});
```

Behind the scenes this starts a `FlushWorker` — a background interval that drains a queue of pending HTTP calls every 2 seconds (or immediately when the queue fills to 50 items).

#### Step 2 — Start a trace for each request

When a user query arrives, the agent opens a new trace:

```typescript
const session = await sdk.startTrace({
  projectId: 'my-project',
  agentVersion: '1.4.2',
  modelName: 'gpt-4o',
  input: userQuery,
});
```

This makes a single blocking HTTP call (`POST /traces`) to create the trace record and get back a `traceId`. Everything after this is non-blocking.

#### Step 3 — Record steps automatically (wrappers)

Instead of manually timing and logging each call, the SDK provides wrapper functions that instrument existing functions transparently:

**`tracedLLM`** — wraps any LLM callable:
```typescript
const llm = tracedLLM(openaiClient.chat, session, {
  name: 'gpt-4o',
  extractTokenUsage: (res) => ({
    promptTokens: res.usage.prompt_tokens,
    completionTokens: res.usage.completion_tokens,
    totalTokens: res.usage.total_tokens,
  }),
});

// Now just call it normally — timing and token tracking happen automatically
const response = await llm(messages);
```

**`tracedTool`** — wraps any tool function:
```typescript
const searchDb = tracedTool(originalSearchDb, session, { name: 'search_db' });

// Calling searchDb records a tool_call step with input, output, and latency
const rows = await searchDb(query);
```

**`tracedRetriever`** — same pattern for retrieval steps.

Each wrapper uses a `timed()` utility that records `startedAt`, `endedAt`, and `latencyMs` automatically. If the wrapped function throws, the error is captured in the step and re-thrown so the agent's own error handling is unaffected.

#### Step 4 — Steps are enqueued, not sent immediately

When a wrapper records a step, it calls `session.addStep(payload)`, which puts the HTTP call onto the `FlushWorker`'s queue. The agent continues executing without waiting for the step to be sent. The worker drains the queue in the background, retrying up to 3 times with exponential backoff on network errors.

#### Step 5 — Close the trace

When the agent produces its final answer:

```typescript
session.complete({ output: finalAnswer });
// or on error:
session.fail({ error: errorMessage });
```

These are also enqueued (non-blocking). Before process exit, call `sdk.flush()` or `sdk.shutdown()` to ensure nothing is lost.

#### `failSilently` mode

With `failSilently: true` (the default), if the tracing backend is down or unreachable:
- `startTrace` catches the error and returns a **no-op session** — every method on it does nothing.
- Enqueued operations that fail after all retries are silently discarded.

The agent never sees a tracing error. Tracing is strictly observability infrastructure and must never impact production requests.

---

### Data model

A **Trace** represents one complete agent turn:

| Field | Description |
|---|---|
| `traceId` | UUID |
| `projectId` | Tenant identifier (from the API key) |
| `agentVersion` | e.g. `"1.4.2"` |
| `modelName` | e.g. `"gpt-4o"` |
| `status` | `running` → `completed` or `failed` |
| `input` / `output` | The user query and final agent answer |
| `startTime` / `endTime` | Wall clock times |
| `tokenUsage` | Aggregated across all LLM steps |
| `steps[]` | Ordered list of Steps |

Each **Step** has a `type` (`llm_call`, `tool_call`, `retrieval`, `reasoning`, `custom`), timing fields, token usage, and an optional list of **Artifacts**. Artifacts are typed payloads — `sql`, `chart`, `table`, `image`, `text` — with their raw content encoded as UTF-8 or base64.

---

### The backend endpoints

All write endpoints require a `Bearer` token (the project API key):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/traces` | Create a new trace (called by SDK `startTrace`) |
| `POST` | `/traces/:id/steps` | Append a step (called by the flush worker) |
| `PATCH` | `/traces/:id/complete` | Mark completed |
| `PATCH` | `/traces/:id/fail` | Mark failed |
| `GET` | `/traces/:id` | Fetch a single trace |

The body of each request is validated with Zod. Steps cannot be added to a trace that is already completed or failed — the domain enforces this before saving.

---

## 2. Dashboard

The Dashboard service is the read path for the frontend UI. It exposes two endpoints: one to list traces and one to fetch a single trace's full span detail. It does no writes.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/dashboard/api/traces` | List traces with optional `lookback` and `limit` query params |
| `GET` | `/dashboard/api/traces/:id` | Fetch full span detail for a single trace |

These endpoints have no auth requirement. For local development the backend falls back to a `DEFAULT_API_KEY` environment variable so the UI works without any configuration.

### What the controller does

The controller reads raw `Trace` objects from the same repository used by the Tracing service and maps them into two response shapes:

- **List response** — one lightweight row per trace containing: `traceId`, `conversationId`, `model`, `spanCount`, `durationMs`, `status`, `tokens`, and a list of distinct tool call names. This feeds the traces table in the UI.
- **Detail response** — the full trace expanded into a flat list of spans with timing, attributes, and artifacts. The spans are sorted by start time so the UI can render a timeline.

The `lookback` query param (e.g. `6h`, `24h`) is parsed into a cutoff timestamp and passed to the repository as a filter.

---

## 3. Evaluation

The Evaluation service lets you measure how well the agent's outputs match expected (golden) outputs. It supports two workflows.

### Inline per-trace evaluation

You pick a trace that was already recorded, provide the expected output for each category (SQL, chart, tools, or plain text), and the service scores the agent's actual output against it. Results are saved per-trace and shown in the UI the next time you open that trace.

**Endpoint:** `POST /evaluation/evaluate-traces`

The service finds the actual artifact from the trace (looking for SQL in step artifacts first, then sniffing step output; same approach for SVG charts). It then runs the appropriate metric functions and writes the result to `data/trace-evals/<traceId>.json`. The next time the panel opens, `GET /evaluation/traces/:id/eval` reads that file back.

### Dataset-driven evaluation

You build a dataset of input/golden-output pairs, then trigger a run which replays every example against a live agent and scores the results.

**Dataset endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/evaluation/datasets` | Create a new dataset |
| `POST` | `/evaluation/datasets/:id/examples` | Upload examples to a dataset |
| `GET` | `/evaluation/datasets` | List all datasets |
| `GET` | `/evaluation/datasets/:id` | Get a dataset with its examples |
| `POST` | `/evaluation/datasets/from-traces` | Create a dataset from existing traces |

**Run endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/evaluation/runs` | Create a new evaluation run |
| `POST` | `/evaluation/runs/:id/execute` | Execute the run (calls the live agent for each example) |
| `GET` | `/evaluation/runs/:id` | Get a run's status |
| `GET` | `/evaluation/runs` | List all runs |
| `GET` | `/evaluation/runs/:id/results` | Get scored results for a completed run |

When a run executes, it sends each example's input to the configured `AGENT_URL` via HTTP, collects the response, and scores it against the golden output using the same metric functions as the inline flow.

### Metrics

#### SQL (`computeSqlMetrics`)

| Metric | What it checks |
|---|---|
| `sql_exact_match` | Exact match after lowercasing and whitespace normalization |
| `sql_normalized_match` | Same as above but also strips comments and trailing semicolons |
| `sql_syntax_valid` | Output starts with a valid DML/DDL keyword and has balanced parentheses |
| `sql_columns_match` | Column list in `SELECT … FROM` matches between agent and golden |

#### Chart (`computeChartMetrics`)

| Metric | What it checks |
|---|---|
| `chart_svg_valid` | Output contains a well-formed `<svg>` tag |
| `chart_type_match` | SVG contains the expected chart type keyword (bar, line, pie, etc.) |
| `chart_svg_similarity` | Levenshtein similarity between the two SVG strings |
| `chart_data_present` | SVG contains colored, non-zero-size data elements (filters out invisible/background rects) |

#### Overall (`computeOverallMetrics`)

| Metric | What it checks |
|---|---|
| `exact_match` | Exact string equality after trimming |
| `string_similarity` | Levenshtein similarity normalized to 0–1 |
| `contains_match` | Golden text appears somewhere in the agent output |
| `pass_fail` | Output is non-empty and not an error message |
| `json_exact_match` | Deep equality of parsed JSON |

---

## 4. Frontend

The frontend (`apps/ai-agent-eval-ui`) is a Vite + React 19 single-page app. There is no client-side router — view switching is controlled by a single `activePage` state in `App.tsx`. Vite proxies `/dashboard/api/**` and `/evaluation/**` to the backend on port 4097.

**Dashboard page** — shows KPI cards (success rate, latency percentiles, token averages, error count) and a set of charts: volume over time, status breakdown, latency distribution, top tools, token distribution, span count distribution, and a models comparison table. Each chart section has a toggle to switch between chart types.

**Tracing page** — shows a filterable table of conversations and traces. Selecting a trace opens a side panel with three tabs: a span timeline, an artifacts viewer (renders SQL, SVG charts, and tables inline), and an eval tab. The eval tab loads any previously saved result on open; if none exists it shows a form to enter golden outputs and run a new evaluation.

**Evaluation page** — entry point for creating datasets and eval runs. The Ground Truth card opens a wizard for building a dataset from existing traces or uploading examples manually.

All charts are hand-rolled SVG with no external library (`DonutChart`, `VerticalBarChart`, `AreaChart` in `charts.tsx`).

### Persistence

When `DATABASE_URL` is set, all data goes to Postgres. Otherwise the service writes JSON files under `data/` — one file per trace, dataset, and evaluation run. This means the service works with zero setup locally.

Per-trace inline eval results are stored separately in `data/trace-evals/` rather than in the main evaluation tables, since they don't belong to a dataset or run.
