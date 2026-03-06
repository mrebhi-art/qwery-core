import { useEffect, useState } from 'react';
import { fetchTrace, evaluateTracesDirectly } from '../api';
import type { EvaluationMetricsConfig, TraceEvalResult } from '../api';
import type { TraceListItem, Artifact, TraceDetail } from '../types';

// ─── Metric catalogue ─────────────────────────────────────────────────────────

type MetricOption = { id: string; label: string; hint: string };

const SQL_OPTIONS: MetricOption[] = [
  { id: 'sql_exact_match',      label: 'Exact Match',      hint: 'Byte-for-byte equal after whitespace normalisation' },
  { id: 'sql_normalized_match', label: 'Normalised Match', hint: 'Case-insensitive, keyword-normalised comparison' },
  { id: 'sql_syntax_valid',     label: 'Syntax Valid',     hint: 'Heuristic check that the output is valid SQL' },
  { id: 'sql_columns_match',    label: 'Columns Match',    hint: 'SELECT-list columns match the golden query' },
];
const CHART_OPTIONS: MetricOption[] = [
  { id: 'chart_svg_valid',       label: 'SVG Valid',       hint: 'Output contains a well-formed <svg> element' },
  { id: 'chart_type_match',      label: 'Type Match',      hint: 'Chart type matches the golden' },
  { id: 'chart_svg_similarity',  label: 'SVG Similarity',  hint: 'Compares data values, labels and mark count vs golden' },
  { id: 'chart_data_present',    label: 'Data Present',    hint: 'SVG contains data-carrying elements (rect/path/circle)' },
];
const TOOL_OPTIONS: MetricOption[] = [
  { id: 'tool_called',           label: 'Tool Called',      hint: 'Expected tool name appears in the output' },
  { id: 'tool_args_exact',       label: 'Args Exact',       hint: 'Tool arguments match golden exactly (JSON)' },
  { id: 'tool_args_similarity',  label: 'Args Similarity',  hint: 'Fuzzy match of serialised tool arguments' },
  { id: 'tool_sequence_correct', label: 'Sequence Correct', hint: 'Tool call order matches golden sequence' },
];
const OVERALL_OPTIONS: MetricOption[] = [
  { id: 'exact_match',       label: 'Exact Match',      hint: 'Exact string equality (normalised)' },
  { id: 'string_similarity', label: 'String Similarity', hint: 'Levenshtein-based similarity (0–1)' },
  { id: 'pass_fail',         label: 'Pass / Fail',       hint: 'Binary: passes if similarity ≥ 0.8' },
  { id: 'json_exact_match',  label: 'JSON Exact',        hint: 'Deep structural JSON equality' },
  { id: 'contains_match',    label: 'Contains',          hint: 'Golden output contained within agent output' },
];

const METRIC_GROUPS = [
  { key: 'overall' as const, label: 'Overall',  color: '#6366f1', options: OVERALL_OPTIONS },
  { key: 'sql'     as const, label: 'SQL',       color: '#06b6d4', options: SQL_OPTIONS },
  { key: 'chart'   as const, label: 'Chart',     color: '#2563eb', options: CHART_OPTIONS },
  { key: 'tool'    as const, label: 'Tool Calls', color: '#ec4899', options: TOOL_OPTIONS },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseArtifacts(detail: TraceDetail): Artifact[] {
  const out: Artifact[] = [];
  for (const span of detail.spans) {
    const raw = span.attributes?.['artifacts'];
    if (!raw) continue;
    try { const p = JSON.parse(raw); if (Array.isArray(p)) out.push(...(p as Artifact[])); } catch { /* skip */ }
  }
  return out;
}

function scoreLabel(score: number) {
  return `${Math.round(score * 100)}%`;
}

function scoreBg(score: number) {
  if (score >= 0.8) return { background: 'var(--green-dim)', color: 'var(--green)', border: '1px solid var(--green)' };
  if (score >= 0.5) return { background: 'var(--amber-dim)', color: 'var(--amber)', border: '1px solid var(--amber)' };
  return { background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid var(--red)' };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AnnotateRow({
  trace, index, goldenOutput, artifacts, loading,
  onGoldenChange,
}: {
  trace: TraceListItem; index: number; goldenOutput: string;
  artifacts: Artifact[]; loading: boolean;
  onGoldenChange: (val: string) => void;
}) {
  const chartArtifacts = artifacts.filter((a) => a.type === 'chart');
  const sqlArtifacts   = artifacts.filter((a) => a.type === 'sql');

  return (
    <div className="etf-trace-row">
      <div className="etf-trace-header">
        <span className="etf-trace-num">#{index + 1}</span>
        <span className="etf-trace-input">{trace.inputValue.slice(0, 90) || '(no input)'}</span>
        {trace.toolCalls.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {trace.toolCalls.map((t) => <span key={t} className="badge badge-tool">{t}</span>)}
          </div>
        )}
      </div>

      {loading ? (
        <div className="etf-loading">Loading artifacts…</div>
      ) : (
        <>
          {(chartArtifacts.length > 0 || sqlArtifacts.length > 0) && (
            <div className="etf-artifact-row">
              <span className="etf-artifact-label">Use as golden →</span>
              {chartArtifacts.map((a, i) => (
                <button key={`chart-${i}`} className="etf-use-btn etf-use-chart" onClick={() => onGoldenChange(a.data)}>
                  Chart SVG
                </button>
              ))}
              {sqlArtifacts.map((a, i) => (
                <button key={`sql-${i}`} className="etf-use-btn etf-use-sql" onClick={() => onGoldenChange(a.data)}>
                  SQL query
                </button>
              ))}
            </div>
          )}
          <textarea
            className="etf-golden-input"
            placeholder="Paste or type the expected correct output (golden answer) for this trace…"
            value={goldenOutput}
            onChange={(e) => onGoldenChange(e.target.value)}
            rows={3}
          />
        </>
      )}
    </div>
  );
}

function MetricGroup({
  group, selected, onToggle,
}: {
  group: typeof METRIC_GROUPS[number];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const count = group.options.filter((o) => selected.includes(o.id)).length;
  return (
    <div className="eval-metric-group" style={{ borderColor: `${group.color}40` }}>
      <div className="eval-metric-group-header" style={{ borderColor: `${group.color}40` }}>
        <span className="eval-metric-group-dot" style={{ background: group.color }} />
        {group.label}
        {count > 0 && (
          <span className="eval-metric-group-count" style={{ background: `${group.color}18`, color: group.color }}>
            {count}
          </span>
        )}
      </div>
      <div className="eval-metric-group-list">
        {group.options.map((opt) => {
          const on = selected.includes(opt.id);
          return (
            <div
              key={opt.id}
              className={`eval-metric-item${on ? ' selected' : ''}`}
              onClick={() => onToggle(opt.id)}
            >
              <input type="checkbox" checked={on} onChange={() => onToggle(opt.id)} />
              <div className="eval-metric-item-text">
                <div className="eval-metric-item-label">{opt.label}</div>
                <div className="eval-metric-item-hint">{opt.hint}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultRow({ result, index }: { result: TraceEvalResult; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="etf-result-row">
      <div className="etf-result-header" onClick={() => setOpen((v) => !v)} style={{ cursor: 'pointer' }}>
        <span className="etf-trace-num">#{index + 1}</span>
        <span className="etf-trace-input" style={{ flex: 1 }}>{result.inputPreview || '(unknown)'}</span>
        {result.error ? (
          <span className="etf-score-badge" style={scoreBg(0)}>Error</span>
        ) : (
          <span className="etf-score-badge" style={scoreBg(result.score)}>
            {result.passed ? '✓' : '✗'} {scoreLabel(result.score)}
          </span>
        )}
        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="etf-result-detail">
          {result.error ? (
            <div className="etf-error">{result.error}</div>
          ) : (
            <div className="etf-metric-chips">
              {result.metrics.map((m) => (
                <span key={m.metric} className="etf-metric-chip" style={scoreBg(m.score)} title={m.detail}>
                  {m.metric.replace(/_/g, ' ')} · {scoreLabel(m.score)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

type Props = {
  selectedTraces: TraceListItem[];
  onClose: () => void;
  onResults: (results: TraceEvalResult[]) => void;
};

const DEFAULT_METRICS: EvaluationMetricsConfig = {
  sql: [], chart: [], tool: [], overall: ['string_similarity'],
};

export default function EvalTracesFlow({ selectedTraces, onClose, onResults }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [goldenOutputs, setGoldenOutputs] = useState<Record<string, string>>({});
  const [artifacts, setArtifacts] = useState<Record<string, Artifact[]>>({});
  const [loadingTraces, setLoadingTraces] = useState<Set<string>>(new Set(selectedTraces.map((t) => t.traceId)));
  const [metrics, setMetrics] = useState<EvaluationMetricsConfig>(DEFAULT_METRICS);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TraceEvalResult[] | null>(null);

  // Load trace details to get artifacts
  useEffect(() => {
    selectedTraces.forEach((t) => {
      fetchTrace(t.traceId)
        .then((detail: TraceDetail) => {
          setArtifacts((prev) => ({ ...prev, [t.traceId]: parseArtifacts(detail) }));
        })
        .finally(() => {
          setLoadingTraces((prev) => {
            const next = new Set(prev);
            next.delete(t.traceId);
            return next;
          });
        });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMetric = (category: keyof EvaluationMetricsConfig, id: string) => {
    setMetrics((prev) => {
      const list = prev[category] as string[];
      return {
        ...prev,
        [category]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
      };
    });
  };

  const totalSelected = Object.values(metrics).flat().length;
  const allAnnotated  = selectedTraces.every((t) => (goldenOutputs[t.traceId] ?? '').trim().length > 0);
  const canRun        = allAnnotated && totalSelected > 0;

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await evaluateTracesDirectly(
        selectedTraces.map((t) => ({ traceId: t.traceId, goldenOutput: goldenOutputs[t.traceId] ?? '' })),
        metrics,
      );
      setResults(res.results);
      onResults(res.results);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed');
    } finally {
      setRunning(false);
    }
  };

  const summary = results
    ? { passed: results.filter((r) => r.passed).length, total: results.length, avg: results.reduce((s, r) => s + r.score, 0) / results.length }
    : null;

  const STEPS = ['Annotate', 'Metrics', 'Results'];

  return (
    <div className="eval-overlay">
      <div className="eval-modal etf-modal">
        {/* Header */}
        <div className="eval-modal-header">
          <div>
            <div className="eval-modal-title">Evaluate Traces</div>
            <div className="eval-modal-subtitle">
              {step === 1 && `${selectedTraces.length} trace${selectedTraces.length > 1 ? 's' : ''} — provide expected outputs`}
              {step === 2 && 'Choose evaluation metrics'}
              {step === 3 && 'Evaluation complete'}
            </div>
          </div>
          <button className="eval-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Step indicators */}
        <div className="dtf-steps">
          {STEPS.map((label, i) => (
            <div key={i} className={`dtf-step${step === i + 1 ? ' active' : step > i + 1 ? ' done' : ''}`}>
              <span className="dtf-step-dot">{step > i + 1 ? '✓' : i + 1}</span>
              <span className="dtf-step-label">{label}</span>
            </div>
          ))}
        </div>

        {/* ── Step 1: Annotate ── */}
        {step === 1 && (
          <div className="etf-body">
            <p className="etf-hint">
              For each trace, provide the <strong>expected correct output</strong> (golden answer).
              Click an artifact button to pre-fill, or type manually.
            </p>
            <div className="etf-traces-list">
              {selectedTraces.map((t, i) => (
                <AnnotateRow
                  key={t.traceId}
                  trace={t}
                  index={i}
                  goldenOutput={goldenOutputs[t.traceId] ?? ''}
                  artifacts={artifacts[t.traceId] ?? []}
                  loading={loadingTraces.has(t.traceId)}
                  onGoldenChange={(val) => setGoldenOutputs((prev) => ({ ...prev, [t.traceId]: val }))}
                />
              ))}
            </div>
            <div className="etf-footer">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn"
                disabled={!allAnnotated}
                title={!allAnnotated ? 'Fill in the expected output for every trace' : undefined}
                onClick={() => setStep(2)}
              >
                Next → Metrics
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Metrics ── */}
        {step === 2 && (
          <div className="etf-body">
            <p className="etf-hint">
              Select the metrics to run. Use <strong>Chart</strong> metrics when annotating with SVG golden outputs,
              <strong> SQL</strong> metrics for query comparison, <strong>Overall</strong> for general text similarity.
            </p>
            <div className="eval-metric-groups">
              {METRIC_GROUPS.map((g) => (
                <MetricGroup
                  key={g.key}
                  group={g}
                  selected={metrics[g.key] as string[]}
                  onToggle={(id) => toggleMetric(g.key, id)}
                />
              ))}
            </div>
            {error && <div className="etf-error">{error}</div>}
            <div className="etf-footer">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
              <button
                className="btn btn-primary"
                disabled={!canRun || running}
                title={totalSelected === 0 ? 'Select at least one metric' : undefined}
                onClick={handleRun}
              >
                {running ? 'Running…' : `Run Evaluation (${totalSelected} metric${totalSelected !== 1 ? 's' : ''})`}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Results ── */}
        {step === 3 && results && summary && (
          <div className="etf-body">
            <div className="etf-summary-bar">
              <div className="etf-summary-stat">
                <span className="etf-summary-val">{summary.passed}/{summary.total}</span>
                <span className="etf-summary-key">Passed</span>
              </div>
              <div className="etf-summary-stat">
                <span className="etf-summary-val" style={scoreBg(summary.avg)}>{scoreLabel(summary.avg)}</span>
                <span className="etf-summary-key">Avg Score</span>
              </div>
              <div className="etf-summary-stat">
                <span className="etf-summary-val">{totalSelected}</span>
                <span className="etf-summary-key">Metrics</span>
              </div>
            </div>
            <div className="etf-results-list">
              {results.map((r, i) => <ResultRow key={r.traceId} result={r} index={i} />)}
            </div>
            <div className="etf-footer">
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              <button className="btn" onClick={() => { setStep(2); setResults(null); }}>← Re-run</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
