-- ─── Traces table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS traces (
  id                  TEXT        PRIMARY KEY,
  project_id          TEXT        NOT NULL,
  agent_version       TEXT        NOT NULL,
  model_name          TEXT        NOT NULL,

  -- payload (stored as JSONB for query flexibility)
  input               JSONB       NOT NULL DEFAULT 'null',
  output              JSONB,

  -- status machine
  status              TEXT        NOT NULL CHECK (status IN ('running','completed','failed')) DEFAULT 'running',
  error               TEXT,

  -- performance
  total_latency_ms    BIGINT      NOT NULL DEFAULT 0,
  total_prompt_tokens    INTEGER  NOT NULL DEFAULT 0,
  total_completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens        INTEGER     NOT NULL DEFAULT 0,

  -- arbitrary extra data
  metadata            JSONB       NOT NULL DEFAULT '{}',

  -- SaaS multi-tenant isolation
  api_key             TEXT        NOT NULL,

  -- timestamps
  started_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_traces_api_key         ON traces (api_key);
CREATE INDEX IF NOT EXISTS idx_traces_project_id      ON traces (project_id);
CREATE INDEX IF NOT EXISTS idx_traces_status          ON traces (status);
CREATE INDEX IF NOT EXISTS idx_traces_started_at      ON traces (started_at DESC);

-- ─── Steps table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trace_steps (
  id              TEXT        PRIMARY KEY,
  trace_id        TEXT        NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
  sequence        INTEGER     NOT NULL,

  type            TEXT        NOT NULL CHECK (type IN ('llm_call','tool_call','retrieval','reasoning','custom')),
  name            TEXT        NOT NULL,

  input           JSONB       NOT NULL DEFAULT 'null',
  output          JSONB,
  error           TEXT,

  latency_ms      BIGINT      NOT NULL DEFAULT 0,

  prompt_tokens      INTEGER,
  completion_tokens  INTEGER,
  total_tokens       INTEGER,

  metadata        JSONB       NOT NULL DEFAULT '{}',
  artifacts       JSONB       NOT NULL DEFAULT '[]',

  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ NOT NULL,

  UNIQUE (trace_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_steps_trace_id   ON trace_steps (trace_id);
CREATE INDEX IF NOT EXISTS idx_steps_type       ON trace_steps (type);

-- Backfill artifacts column for databases created before this column was added
ALTER TABLE trace_steps ADD COLUMN IF NOT EXISTS artifacts JSONB NOT NULL DEFAULT '[]';

-- ─── Evaluation: Datasets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eval_datasets (
  id           TEXT        PRIMARY KEY,
  name         TEXT        NOT NULL,
  description  TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL
);

-- ─── Evaluation: Dataset Examples ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eval_dataset_examples (
  id            TEXT        PRIMARY KEY,
  dataset_id    TEXT        NOT NULL REFERENCES eval_datasets(id) ON DELETE CASCADE,
  input         TEXT        NOT NULL,
  context       TEXT,
  golden_output TEXT        NOT NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_examples_dataset_id ON eval_dataset_examples (dataset_id);

-- ─── Evaluation: Runs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eval_runs (
  id              TEXT        PRIMARY KEY,
  dataset_id      TEXT        NOT NULL REFERENCES eval_datasets(id),
  agent_version   TEXT        NOT NULL,
  agent_url       TEXT        NOT NULL,
  -- metrics is a JSONB object shaped as EvaluationMetricsConfig:
  --   { sql: string[], chart: string[], tool: string[], overall: string[] }
  metrics         JSONB       NOT NULL DEFAULT '{"sql":[],"chart":[],"tool":[],"overall":[]}',
  status          TEXT        NOT NULL CHECK (status IN ('pending','running','completed','failed')) DEFAULT 'pending',
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset_id ON eval_runs (dataset_id);
CREATE INDEX IF NOT EXISTS idx_eval_runs_status     ON eval_runs (status);

-- ─── Evaluation: Results ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eval_results (
  id           TEXT        PRIMARY KEY,
  run_id       TEXT        NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  example_id   TEXT        NOT NULL REFERENCES eval_dataset_examples(id),
  agent_output TEXT        NOT NULL,
  metrics      JSONB       NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_results_run_id ON eval_results (run_id);
