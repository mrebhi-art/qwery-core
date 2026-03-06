import { useEffect, useMemo, useState } from 'react';
import type { Artifact, Span, TraceDetail } from '../types';
import type { TraceEvalResult, TraceEvalMetricResult, TraceEvalItem } from '../api';
import { evaluateTracesDirectly, fetchTraceEval } from '../api';
import JsonViewer from './JsonViewer';

const KIND_COLORS: Record<string, string> = {
  chain: '#6366f1',
  agent: '#8b5cf6',
  llm: '#f59e0b',
  retriever: '#10b981',
  tool: '#ec4899',
  sql: '#06b6d4',
};

function formatDuration(ms: number) {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function kindFromAttributes(attrs: Record<string, string>) {
  return (attrs['openinference.span.kind'] || 'chain').toLowerCase();
}

function spanLabel(span: Span) {
  const op = span.operationName;
  const attrs = span.attributes || {};
  if (op === 'agent.run') return attrs['agent.id'] || op;
  if (op === 'llm.call') return attrs['llm.model_name'] || 'LLM';
  if (op.startsWith('tool.')) return op.slice(5);
  if (op.startsWith('retrieval.')) return op.slice(10);
  if (op.startsWith('agent.')) return op.slice(6);
  return op;
}

function getTimelineBounds(spans: Span[]) {
  const startUs = Math.min(...spans.map((s) => s.startTimeUs));
  const endUs = Math.max(...spans.map((s) => s.startTimeUs + s.durationMs * 1000));
  return { startUs, endUs };
}

type TimelinePanelProps = {
  detail: TraceDetail;
  onClose: () => void;
};

export default function TimelinePanel({ detail, onClose }: TimelinePanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'timeline' | 'evaluation'>('timeline');
  const spans = detail.spans ?? [];
  const selected = spans[selectedIndex];
  const bounds = useMemo(() => getTimelineBounds(spans), [spans]);
  const totalMs = Math.max((bounds.endUs - bounds.startUs) / 1000, 1);

  return (
    <>
      <div className="panel-header">
        <div className="panel-header-row">
          <h2>{detail.rootOperation || detail.traceId.slice(0, 10)}</h2>
          <button className="panel-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-meta">
          <span className="mono">{detail.traceId.slice(0, 16)}…</span>
          <span>{detail.spanCount} spans</span>
          <span>{formatDuration(totalMs)}</span>
        </div>
      </div>
      <div className="panel-body">
        <div className="panel-tabs">
          <div
            className={`panel-tab${activeTab === 'timeline' ? ' active' : ''}`}
            onClick={() => setActiveTab('timeline')}
          >
            Timeline
          </div>
          <div
            className={`panel-tab${activeTab === 'evaluation' ? ' active' : ''}`}
            onClick={() => setActiveTab('evaluation')}
          >
            Evaluation
          </div>
        </div>
        {activeTab === 'evaluation' ? (
          <TraceEvalTab traceId={detail.traceId} />
        ) : null}
        <div className={`panel-tab-content${activeTab === 'timeline' ? ' active' : ''}`}>
          <div className="waterfall">
            <div className="wf-ruler">
              {[0, 1, 2, 3, 4, 5, 6].map((tick) => (
                <span key={tick} className="wf-tick">
                  {formatDuration((totalMs * tick) / 6)}
                </span>
              ))}
            </div>
            {spans.map((span, index) => {
              const kind = kindFromAttributes(span.attributes);
              const color = KIND_COLORS[kind] || '#6366f1';
              const offset = ((span.startTimeUs - bounds.startUs) / 1000 / totalMs) * 100;
              const width = Math.max((span.durationMs / totalMs) * 100, 0.5);
              return (
                <div
                  key={span.spanId}
                  className={`wf-row ${selectedIndex === index ? 'selected' : ''}`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <div className="wf-label">
                    <span className="wf-dot" style={{ background: color }} />
                    <span className="wf-name">{spanLabel(span)}</span>
                  </div>
                  <div className="wf-track">
                    <div className="wf-bar" style={{ left: `${offset}%`, width: `${width}%`, background: color }}>
                      {width > 10 ? <span className="wf-bar-label">{formatDuration(span.durationMs)}</span> : null}
                    </div>
                  </div>
                  <div className="wf-dur">{formatDuration(span.durationMs)}</div>
                </div>
              );
            })}
          </div>
          {selected ? (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div className="detail-section">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span
                    className="wf-dot"
                    style={{ width: 10, height: 10, background: KIND_COLORS[kindFromAttributes(selected.attributes)] || '#6366f1' }}
                  />
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{selected.operationName}</span>
                </div>
                <table className="detail-table">
                  <tbody>
                    <tr>
                      <td>Kind</td>
                      <td>{kindFromAttributes(selected.attributes)}</td>
                    </tr>
                    <tr>
                      <td>Duration</td>
                      <td>{formatDuration(selected.durationMs)}</td>
                    </tr>
                    <tr>
                      <td>Status</td>
                      <td>{selected.status === 'error' ? 'Error' : 'OK'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {selected.attributes?.['input.value'] ? (
                <JsonViewer id={`input-${selected.spanId}`} label="Input" value={selected.attributes['input.value']} defaultMode="json" />
              ) : null}
              {selected.attributes?.['output.value'] ? (
                <JsonViewer id={`output-${selected.spanId}`} label="Output" value={selected.attributes['output.value']} defaultMode="json" />
              ) : null}
              <ArtifactList attributes={selected.attributes} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ─── Evaluation result panel ─────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  overall: '#6366f1',
  sql:     '#06b6d4',
  chart:   '#2563eb',
  tool:    '#ec4899',
};

function scoreBg(score: number) {
  if (score >= 0.8) return { bg: 'var(--green-dim)', fg: 'var(--green)', border: 'var(--green)' };
  if (score >= 0.5) return { bg: 'var(--amber-dim)', fg: 'var(--amber)', border: 'var(--amber)' };
  return { bg: 'var(--red-dim)', fg: 'var(--red)', border: 'var(--red)' };
}

/** Very simple line-level diff: returns tokens tagged added/removed/same */
function lineDiff(a: string, b: string) {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const result: Array<{ kind: 'same' | 'removed' | 'added'; text: string }> = [];
  const maxLen = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < maxLen; i++) {
    const al = aLines[i];
    const bl = bLines[i];
    if (al === undefined) {
      result.push({ kind: 'added',   text: bl! });
    } else if (bl === undefined) {
      result.push({ kind: 'removed', text: al });
    } else if (al === bl) {
      result.push({ kind: 'same',    text: al });
    } else {
      result.push({ kind: 'removed', text: al });
      result.push({ kind: 'added',   text: bl });
    }
  }
  return result;
}

function MetricRow({ m }: { m: TraceEvalMetricResult }) {
  const c = scoreBg(m.score);
  return (
    <div className="ep-metric-row">
      <div className="ep-metric-left">
        <span
          className="ep-metric-badge"
          style={{ background: c.bg, color: c.fg, borderColor: c.border }}
        >
          {m.passed ? '✓' : '✗'} {Math.round(m.score * 100)}%
        </span>
        <span className="ep-metric-name">{m.metric.replace(/_/g, ' ')}</span>
      </div>
      <div className="ep-score-bar-wrap">
        <div className="ep-score-bar" style={{ width: `${Math.round(m.score * 100)}%`, background: c.fg }} />
      </div>
      {m.detail ? <p className="ep-metric-detail">{m.detail}</p> : null}
    </div>
  );
}

function EvalResultPanel({ result }: { result: TraceEvalResult }) {
  const grouped = useMemo(() => {
    const map = new Map<string, TraceEvalMetricResult[]>();
    result.metrics.forEach((m) => {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    });
    return map;
  }, [result]);

  const diffLines = useMemo(
    () => lineDiff(result.goldenOutput ?? '', result.agentOutput ?? ''),
    [result.goldenOutput, result.agentOutput],
  );

  const c = scoreBg(result.score);

  return (
    <div className="panel-tab-content active ep-panel">
      {/* Summary */}
      <div className="ep-summary">
        <span
          className="ep-summary-badge"
          style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
        >
          {result.passed ? '✓ Passed' : '✗ Failed'}
        </span>
        <span className="ep-summary-score">{Math.round(result.score * 100)}% overall</span>
        <span className="ep-summary-counts">
          {result.metrics.filter((m) => m.passed).length}/{result.metrics.length} metrics passed
        </span>
      </div>

      {result.error ? (
        <div className="ep-error">{result.error}</div>
      ) : (
        <>
          {/* Per-category metrics */}
          {Array.from(grouped.entries()).map(([cat, metrics]) => (
            <div key={cat} className="ep-category">
              <div
                className="ep-category-header"
                style={{ borderColor: `${CATEGORY_COLORS[cat] ?? '#6366f1'}50`, color: CATEGORY_COLORS[cat] ?? '#6366f1' }}
              >
                <span
                  className="ep-category-dot"
                  style={{ background: CATEGORY_COLORS[cat] ?? '#6366f1' }}
                />
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
                <span className="ep-category-pill" style={{ background: `${CATEGORY_COLORS[cat] ?? '#6366f1'}18` }}>
                  {metrics.filter((m) => m.passed).length}/{metrics.length}
                </span>
              </div>
              <div className="ep-metrics-list">
                {metrics.map((m) => <MetricRow key={m.metric} m={m} />)}
              </div>
            </div>
          ))}

          {/* Output diff */}
          <div className="ep-diff-section">
            <div className="ep-diff-header">Output Diff</div>
            <div className="ep-diff-cols">
              <div className="ep-diff-col">
                <div className="ep-diff-col-label" style={{ color: 'var(--green)' }}>Golden (expected)</div>
                <pre className="ep-diff-pre">
                  {diffLines.map((l, i) =>
                    l.kind === 'same' || l.kind === 'removed' ? (
                      <div
                        key={i}
                        className={`ep-diff-line${l.kind === 'removed' ? ' ep-diff-removed' : ''}`}
                      >
                        {l.kind === 'removed' ? <span className="ep-diff-sigil">-</span> : <span className="ep-diff-sigil" />}
                        {l.text || '\u00a0'}
                      </div>
                    ) : null,
                  )}
                </pre>
              </div>
              <div className="ep-diff-col">
                <div className="ep-diff-col-label" style={{ color: 'var(--amber)' }}>Agent (predicted)</div>
                <pre className="ep-diff-pre">
                  {diffLines.map((l, i) =>
                    l.kind === 'same' || l.kind === 'added' ? (
                      <div
                        key={i}
                        className={`ep-diff-line${l.kind === 'added' ? ' ep-diff-added' : ''}`}
                      >
                        {l.kind === 'added' ? <span className="ep-diff-sigil">+</span> : <span className="ep-diff-sigil" />}
                        {l.text || '\u00a0'}
                      </div>
                    ) : null,
                  )}
                </pre>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Trace Eval Tab (form + results) ─────────────────────────────────────────

const SQL_METRIC_NAMES   = ['sql_exact_match', 'sql_normalized_match', 'sql_syntax_valid', 'sql_columns_match'] as const;
const CHART_METRIC_NAMES = ['chart_svg_valid', 'chart_data_present', 'chart_type_match', 'chart_svg_similarity'] as const;
const TOOL_METRIC_NAMES  = ['tool_called', 'tool_args_exact', 'tool_args_similarity', 'tool_sequence_correct'] as const;
const OVERALL_METRIC_NAMES = ['exact_match', 'string_similarity', 'pass_fail', 'json_exact_match', 'contains_match'] as const;

/** Metrics that validate without needing a golden output. */
const NO_GOLDEN_NEEDED = new Set(['chart_svg_valid', 'chart_data_present', 'sql_syntax_valid']);

type EvalFormData = {
  goldenSql: string;
  goldenChart: string;
  goldenTool: string;
  goldenOutput: string;
  sqlMetrics: string[];
  chartMetrics: string[];
  toolMetrics: string[];
  overallMetrics: string[];
};

function toggle(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

type MetricGroupProps = {
  label: string;
  color: string;
  metrics: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
  goldenLabel: string;
  goldenValue: string;
  onGoldenChange: (v: string) => void;
  placeholder?: string;
  goldenNote?: string;
};

function MetricGroup({ label, color, metrics, selected, onChange, goldenLabel, goldenValue, onGoldenChange, placeholder, goldenNote }: MetricGroupProps) {
  const needsGolden = selected.some((m) => !NO_GOLDEN_NEEDED.has(m));
  return (
    <div style={{ marginBottom: 16, borderRadius: 8, border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: `${color}12`, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 12, color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginBottom: needsGolden ? 10 : 0 }}>
          {metrics.map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={selected.includes(m)}
                onChange={() => onChange(toggle(selected, m))}
                style={{ accentColor: color }}
              />
              <span style={{ color: selected.includes(m) ? 'var(--text)' : 'var(--text-secondary)' }}>
                {m.replace(/_/g, ' ')}
              </span>
            </label>
          ))}
        </div>
        {needsGolden && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
              {goldenLabel}{goldenNote ? <span style={{ marginLeft: 6, opacity: 0.6 }}>{goldenNote}</span> : null}
            </div>
            <textarea
              value={goldenValue}
              onChange={(e) => onGoldenChange(e.target.value)}
              placeholder={placeholder}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '6px 8px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6,
                color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 12, outline: 'none',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TraceEvalTab({ traceId }: { traceId: string }) {
  const [form, setForm] = useState<EvalFormData>({
    goldenSql: '', goldenChart: '', goldenTool: '', goldenOutput: '',
    sqlMetrics: [], chartMetrics: ['chart_svg_valid', 'chart_data_present'], toolMetrics: [], overallMetrics: ['string_similarity'],
  });
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<TraceEvalResult | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchTraceEval(traceId)
      .then(({ result: saved }) => {
        if (!mounted) return;
        if (saved) {
          setResult(saved as TraceEvalResult);
          setSavedAt((saved as { savedAt?: string }).savedAt ?? null);
          setShowForm(false);
        } else {
          setShowForm(true);
        }
      })
      .catch(() => { if (mounted) setShowForm(true); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [traceId]);

  const anyMetric = form.sqlMetrics.length + form.chartMetrics.length + form.toolMetrics.length + form.overallMetrics.length > 0;

  async function runEval() {
    setRunning(true);
    setResult(null);
    setEvalError(null);
    try {
      const item: TraceEvalItem = {
        traceId,
        goldenSql:    form.goldenSql    || undefined,
        goldenChart:  form.goldenChart  || undefined,
        goldenTool:   form.goldenTool   || undefined,
        goldenOutput: form.goldenOutput || undefined,
      };
      const response = await evaluateTracesDirectly([item], {
        sql:     form.sqlMetrics,
        chart:   form.chartMetrics,
        tool:    form.toolMetrics,
        overall: form.overallMetrics,
      });
      const r = response.results[0] ?? null;
      if (r?.error) setEvalError(r.error);
      setResult(r);
      setSavedAt(null);
      setShowForm(false);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'Evaluation failed');
      setShowForm(true);
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)', fontSize: 13 }}>Loading…</div>;
  }

  if (result && !showForm) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 0', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          {savedAt ? (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              Last run: {new Date(savedAt).toLocaleString()}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Just evaluated</span>
          )}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '3px 10px', marginLeft: 'auto' }}
            onClick={() => { setShowForm(true); setResult(null); setEvalError(null); }}
          >
            Re-run
          </button>
        </div>
        <EvalResultPanel result={result} />
      </div>
    );
  }

  return (
    <div className="panel-tab-content active" style={{ padding: '12px 8px' }}>
      <MetricGroup
        label="SQL" color="#06b6d4"
        metrics={SQL_METRIC_NAMES} selected={form.sqlMetrics}
        onChange={(m) => setForm((f) => ({ ...f, sqlMetrics: m }))}
        goldenLabel="Expected SQL"
        goldenValue={form.goldenSql}
        onGoldenChange={(v) => setForm((f) => ({ ...f, goldenSql: v }))}
        placeholder="SELECT id, name FROM users WHERE ..."
      />
      <MetricGroup
        label="Chart / SVG" color="#2563eb"
        metrics={CHART_METRIC_NAMES} selected={form.chartMetrics}
        onChange={(m) => setForm((f) => ({ ...f, chartMetrics: m }))}
        goldenLabel="Expected SVG or chart config"
        goldenValue={form.goldenChart}
        onGoldenChange={(v) => setForm((f) => ({ ...f, goldenChart: v }))}
        placeholder="<svg ...>...</svg>"
        goldenNote="(not needed for svg_valid / data_present)"
      />
      <MetricGroup
        label="Tool Calls" color="#ec4899"
        metrics={TOOL_METRIC_NAMES} selected={form.toolMetrics}
        onChange={(m) => setForm((f) => ({ ...f, toolMetrics: m }))}
        goldenLabel="Expected tool calls (JSON)"
        goldenValue={form.goldenTool}
        onGoldenChange={(v) => setForm((f) => ({ ...f, goldenTool: v }))}
        placeholder={`[{"name": "search", "args": {"query": "..."}}]`}
      />
      <MetricGroup
        label="Overall" color="#6366f1"
        metrics={OVERALL_METRIC_NAMES} selected={form.overallMetrics}
        onChange={(m) => setForm((f) => ({ ...f, overallMetrics: m }))}
        goldenLabel="Expected output"
        goldenValue={form.goldenOutput}
        onGoldenChange={(v) => setForm((f) => ({ ...f, goldenOutput: v }))}
        placeholder="Expected agent response text..."
      />
      {evalError && (
        <div style={{ margin: '0 0 12px', padding: '8px 12px', background: 'var(--red-dim)', color: 'var(--red)', borderRadius: 6, fontSize: 12, border: '1px solid var(--red)' }}>
          {evalError}
        </div>
      )}
      <button
        className="btn"
        style={{ width: '100%', padding: '10px 0', fontWeight: 700 }}
        onClick={runEval}
        disabled={running || !anyMetric}
      >
        {running ? 'Running…' : 'Run Evaluation'}
      </button>
      {!anyMetric && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 6 }}>
          Select at least one metric to run
        </div>
      )}
    </div>
  );
}

// ─── Artifact helpers ─────────────────────────────────────────────────────────

const ARTIFACT_TYPE_COLORS: Record<string, string> = {
  table: '#059669',
  chart: '#2563eb',
  image: '#7c3aed',
  sql:   '#f59e0b',
  text:  '#6b7280',
};

function downloadArtifact(artifact: Artifact) {
  const bytes =
    artifact.encoding === 'base64'
      ? Uint8Array.from(atob(artifact.data), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(artifact.data);
  const blob = new Blob([bytes], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = artifact.name;
  a.click();
  URL.revokeObjectURL(url);
}

function parseArtifacts(attributes: Record<string, string>): Artifact[] {
  const raw = attributes['artifacts'];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Artifact[]) : [];
  } catch {
    return [];
  }
}

function renderCsvTable(csv: string) {
  const lines = csv.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  const headers = lines[0]!.split(',').map((h) => h.trim());
  const dataRows = lines.slice(1);
  return (
    <div className="artifact-table-wrap">
      <table className="artifact-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri}>
              {row.split(',').map((cell, ci) => <td key={ci}>{cell.trim()}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderJsonTable(json: string) {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed) || parsed.length === 0) return <pre className="artifact-code">{json}</pre>;
    const headers = Object.keys(parsed[0] as object);
    return (
      <div className="artifact-table-wrap">
        <table className="artifact-table">
          <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {(parsed as Record<string, unknown>[]).map((row, ri) => (
              <tr key={ri}>
                {headers.map((h) => <td key={h}>{String(row[h] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } catch {
    return <pre className="artifact-code">{json}</pre>;
  }
}

function ChartJsonPreview({ data }: { data: string }) {
  try {
    const cfg = JSON.parse(data) as {
      chartType?: string;
      title?: string;
      data?: Record<string, unknown>[];
      config?: { colors?: string[]; labels?: Record<string, string> };
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {cfg.chartType && (
            <span style={{ fontSize: 11, fontWeight: 700, background: '#2563eb18', color: '#2563eb', border: '1px solid #2563eb40', borderRadius: 4, padding: '2px 8px' }}>
              {cfg.chartType}
            </span>
          )}
          {cfg.title && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{cfg.title}</span>
          )}
          {cfg.config?.colors && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {cfg.config.colors.map((c, i) => (
                <span key={i} style={{ width: 12, height: 12, borderRadius: 2, background: c, display: 'inline-block', border: '1px solid var(--border)' }} title={c} />
              ))}
            </span>
          )}
        </div>
        {cfg.data && cfg.data.length > 0 && renderJsonTable(JSON.stringify(cfg.data))}
      </div>
    );
  } catch {
    return <pre className="artifact-code">{data}</pre>;
  }
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  const { type, mimeType, data, encoding } = artifact;

  if (mimeType === 'image/svg+xml') {
    return <div className="artifact-svg" dangerouslySetInnerHTML={{ __html: data }} />;
  }
  if (type === 'chart' && mimeType === 'application/json') {
    return <ChartJsonPreview data={data} />;
  }
  if (type === 'chart') {
    return <div className="artifact-svg" dangerouslySetInnerHTML={{ __html: data }} />;
  }
  if (type === 'image' && encoding === 'base64') {
    return <img className="artifact-img" src={`data:${mimeType};base64,${data}`} alt={artifact.name} />;
  }
  if (type === 'table') {
    if (mimeType === 'application/json') return renderJsonTable(data);
    return renderCsvTable(data);
  }
  if (type === 'sql' || type === 'text') {
    if (mimeType === 'application/json') {
      try {
        return <pre className="artifact-code">{JSON.stringify(JSON.parse(data), null, 2)}</pre>;
      } catch { /* fall through */ }
    }
    return <pre className="artifact-code">{data}</pre>;
  }
  return <pre className="artifact-code">{data.slice(0, 400)}</pre>;
}

function ArtifactList({ attributes }: { attributes: Record<string, string> }) {
  const artifacts = parseArtifacts(attributes);
  if (artifacts.length === 0) return null;

  return (
    <div className="artifact-section">
      <div className="artifact-section-header">
        Artifacts
        <span className="artifact-count">{artifacts.length}</span>
      </div>
      <div className="artifact-list">
        {artifacts.map((artifact, i) => (
          <div key={i} className="artifact-card">
            <div className="artifact-card-header">
              <span
                className="artifact-type-badge"
                style={{ background: `${ARTIFACT_TYPE_COLORS[artifact.type] ?? '#6b7280'}18`, color: ARTIFACT_TYPE_COLORS[artifact.type] ?? '#6b7280', borderColor: `${ARTIFACT_TYPE_COLORS[artifact.type] ?? '#6b7280'}40` }}
              >
                {artifact.type}
              </span>
              <span className="artifact-name">{artifact.name}</span>
              <button className="artifact-dl" onClick={() => downloadArtifact(artifact)} title={`Download ${artifact.name}`}>
                ↓ Download
              </button>
            </div>
            <div className="artifact-preview">
              <ArtifactPreview artifact={artifact} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
