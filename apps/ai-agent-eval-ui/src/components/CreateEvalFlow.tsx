import { useRef, useState } from 'react';
import {
  createDataset,
  uploadExamples,
  startEvalRun,
  executeEvalRun,
  getEvalResults,
  type EvaluationMetricsConfig,
  type EvalMetricResult,
  type EvalResult,
  type EvalRun,
} from '../api';

type Step = 'dataset' | 'examples' | 'run' | 'results';

type ExampleInput = { prompt: string; datasources: string };
type ExampleOutput = { tools: string; chart: string; tables: string; messages: string; sql: string };
type ExampleRow = { input: ExampleInput; output: ExampleOutput };

function outputFilled(o: ExampleOutput) {
  return o.tools.trim() || o.chart.trim() || o.tables.trim() || o.messages.trim() || o.sql.trim();
}

type State = {
  step: Step;
  datasetId: string;
  run: EvalRun | null;
  results: EvalResult[];
  busy: boolean;
  error: string | null;
};

// ─── Metric catalogue (per category) ─────────────────────────────────────────────────

type MetricOption = { id: string; label: string; hint: string };

const SQL_METRIC_OPTIONS: MetricOption[] = [
  { id: 'sql_exact_match',      label: 'Exact Match',      hint: 'Byte-for-byte equal after whitespace normalisation' },
  { id: 'sql_normalized_match', label: 'Normalised Match', hint: 'Case-insensitive, keyword-normalised comparison' },
  { id: 'sql_syntax_valid',     label: 'Syntax Valid',     hint: 'Heuristic check that the output is valid SQL' },
  { id: 'sql_columns_match',    label: 'Columns Match',    hint: 'SELECT-list columns match the golden query' },
];

const CHART_METRIC_OPTIONS: MetricOption[] = [
  { id: 'chart_svg_valid',    label: 'SVG Valid',      hint: 'Output contains a well-formed <svg> element' },
  { id: 'chart_type_match',   label: 'Type Match',     hint: 'Chart type (bar/line/pie/…) matches the golden' },
  { id: 'chart_svg_similarity', label: 'SVG Similarity',  hint: 'Compares data values (%), labels and mark count between generated and golden SVG' },
  { id: 'chart_data_present', label: 'Data Present',   hint: 'SVG contains data-carrying elements' },
];

const TOOL_METRIC_OPTIONS: MetricOption[] = [
  { id: 'tool_called',           label: 'Tool Called',          hint: 'Expected tool name appears in the output' },
  { id: 'tool_args_exact',       label: 'Args Exact',           hint: 'Tool arguments match the golden exactly (JSON)' },
  { id: 'tool_args_similarity',  label: 'Args Similarity',      hint: 'Fuzzy match of serialised tool arguments' },
  { id: 'tool_sequence_correct', label: 'Sequence Correct',     hint: 'Tool call order matches golden sequence' },
];

const OVERALL_METRIC_OPTIONS: MetricOption[] = [
  { id: 'exact_match',      label: 'Exact Match',      hint: 'Exact string equality (normalised)' },
  { id: 'string_similarity',label: 'String Similarity', hint: 'Levenshtein-based similarity score (0–1)' },
  { id: 'pass_fail',        label: 'Pass / Fail',      hint: 'Binary: passes if similarity ≥ 0.8' },
  { id: 'json_exact_match', label: 'JSON Exact',       hint: 'Deep structural JSON equality' },
  { id: 'contains_match',   label: 'Contains',         hint: 'Golden output is contained within agent output' },
];

const DEFAULT_METRICS: EvaluationMetricsConfig = {
  sql:     [],
  chart:   [],
  tool:    [],
  overall: ['exact_match', 'string_similarity'],
};

const DEFAULT_ROW = (): ExampleRow => ({
  input: { prompt: '', datasources: '' },
  output: { tools: '', chart: '', tables: '', messages: '', sql: '' },
});

function scoreColor(metric: string, score: number, passed?: boolean) {
  if (metric === 'pass_fail' || metric.endsWith('_valid') || metric.endsWith('_called') || metric.endsWith('_correct')) {
    return passed ? '#059669' : '#c0392b';
  }
  if (score >= 0.8) return '#059669';
  if (score >= 0.5) return '#7a5c00';
  return '#c0392b';
}

const CATEGORY_COLORS: Record<string, string> = {
  sql:     '#06b6d4',
  chart:   '#8b5cf6',
  tool:    '#f59e0b',
  overall: '#6366f1',
};

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] ?? '#6b7280';
  return (
    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px',
      background: `${color}18`, color, border: `1px solid ${color}40`, borderRadius: 4, padding: '1px 5px' }}>
      {category}
    </span>
  );
}

export default function CreateEvalFlow({ onClose }: { onClose: () => void }) {
  const [datasetName, setDatasetName] = useState('');
  const [datasetDesc, setDatasetDesc] = useState('');
  const [rows, setRows] = useState<ExampleRow[]>([DEFAULT_ROW()]);
  const [agentUrl, setAgentUrl] = useState('http://localhost:3000');
  const [agentVersion, setAgentVersion] = useState('1.0.0');
  const [metricsConfig, setMetricsConfig] = useState<EvaluationMetricsConfig>(DEFAULT_METRICS);

  const toggleMetric = (category: keyof EvaluationMetricsConfig, id: string) => {
    setMetricsConfig((prev) => ({
      ...prev,
      [category]: prev[category].includes(id)
        ? prev[category].filter((m) => m !== id)
        : [...prev[category], id],
    }));
  };

  const totalSelected = Object.values(metricsConfig).reduce((s, arr) => s + arr.length, 0);

  const [state, setState] = useState<State>({
    step: 'dataset',
    datasetId: '',
    run: null,
    results: [],
    busy: false,
    error: null,
  });

  const setError = (error: string | null) => setState((s) => ({ ...s, error }));
  const setBusy = (busy: boolean) => setState((s) => ({ ...s, busy }));

  // ── Step 1 ──────────────────────────────────────────────────────────────────
  async function handleCreateDataset() {
    if (!datasetName.trim()) return setError('Dataset name is required.');
    setBusy(true);
    setError(null);
    try {
      const dataset = await createDataset(datasetName.trim(), datasetDesc.trim());
      setState((s) => ({ ...s, datasetId: dataset.id, step: 'examples', busy: false }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: (err as Error).message }));
    }
  }

  // ── Step 2 ──────────────────────────────────────────────────────────────────
  function setInput(i: number, field: keyof ExampleInput, value: string) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, input: { ...r.input, [field]: value } } : r));
  }
  function setOutput(i: number, field: keyof ExampleOutput, value: string) {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, output: { ...r.output, [field]: value } } : r));
  }
  function addRow() { setRows((prev) => [...prev, DEFAULT_ROW()]); }
  function removeRow(i: number) { setRows((prev) => prev.filter((_, idx) => idx !== i)); }

  async function handleUploadExamples() {
    const valid = rows.filter((r) => r.input.prompt.trim() && outputFilled(r.output));
    if (valid.length === 0)
      return setError('Each example needs a Prompt and at least one expected output field.');
    const incomplete = rows.some((r) => r.input.prompt.trim() && !outputFilled(r.output));
    if (incomplete)
      return setError('Every example with a prompt must have at least one expected output field filled.');
    setBusy(true);
    setError(null);
    try {
      await uploadExamples(
        state.datasetId,
        valid.map((r) => ({
          input: JSON.stringify({
            prompt: r.input.prompt.trim(),
            ...(r.input.datasources.trim() ? { datasources: r.input.datasources.trim() } : {}),
          }),
          goldenOutput: JSON.stringify({
            ...(r.output.tools.trim() ? { tools: r.output.tools.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
            ...(r.output.chart.trim() ? { chart: r.output.chart.trim() } : {}),
            ...(r.output.tables.trim() ? { tables: r.output.tables.trim() } : {}),
            ...(r.output.messages.trim() ? { messages: r.output.messages.trim() } : {}),
            ...(r.output.sql.trim() ? { sql: r.output.sql.trim() } : {}),
          }),
          context: undefined,
        })),
      );
      setState((s) => ({ ...s, step: 'run', busy: false }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: (err as Error).message }));
    }
  }

  // ── Step 3 ──────────────────────────────────────────────────────────────────

  async function handleRun() {
    if (!agentUrl.trim()) return setError('Agent URL is required.');
    if (totalSelected === 0) return setError('Select at least one metric.');
    setBusy(true);
    setError(null);
    try {
      const run = await startEvalRun(state.datasetId, agentUrl.trim(), agentVersion.trim() || '1.0.0', metricsConfig);
      const completed = await executeEvalRun(run.id);
      const { results } = await getEvalResults(run.id);
      setState((s) => ({ ...s, run: completed, results, step: 'results', busy: false }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: (err as Error).message }));
    }
  }

  const STEPS: { id: Step; label: string }[] = [
    { id: 'dataset', label: '1 · Dataset' },
    { id: 'examples', label: '2 · Examples' },
    { id: 'run', label: '3 · Run' },
    { id: 'results', label: '4 · Results' },
  ];

  const stepIndex = STEPS.findIndex((s) => s.id === state.step);

  return (
    <div className="eval-flow-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="eval-flow-modal">
        {/* Header */}
        <div className="eval-flow-header">
          <div>
            <div className="eval-flow-title">Ground Truth Evaluation</div>
            <div className="eval-flow-subtitle">Create a dataset, add examples, run against your agent</div>
          </div>
          <button className="panel-close" onClick={onClose}>✕</button>
        </div>

        {/* Step bar */}
        <div className="eval-step-bar">
          {STEPS.map((s, i) => (
            <div key={s.id} className={`eval-step-item${i <= stepIndex ? ' done' : ''}${s.id === state.step ? ' active' : ''}`}>
              <span className="eval-step-dot">{i < stepIndex ? '✓' : i + 1}</span>
              <span className="eval-step-label">{s.label}</span>
              {i < STEPS.length - 1 && <span className="eval-step-line" />}
            </div>
          ))}
        </div>

        {/* Error */}
        {state.error && <div className="eval-flow-error">{state.error}</div>}

        {/* Body */}
        <div className="eval-flow-body">
          {/* ── Step 1: Dataset ─────────────────────────────────────── */}
          {state.step === 'dataset' && (
            <div className="eval-form">
              <div className="eval-field">
                <label>Dataset name *</label>
                <input value={datasetName} onChange={(e) => setDatasetName(e.target.value)} placeholder="e.g. customer-support-v1" autoFocus />
              </div>
              <div className="eval-field">
                <label>Description</label>
                <textarea value={datasetDesc} onChange={(e) => setDatasetDesc(e.target.value)} placeholder="What is this dataset for?" rows={3} />
              </div>
              <div className="eval-flow-actions">
                <button className="btn" disabled={state.busy} onClick={handleCreateDataset}>
                  {state.busy ? 'Creating…' : 'Create Dataset →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Examples ─────────────────────────────────────── */}
          {state.step === 'examples' && (
            <div className="eval-form">
              <p className="eval-hint">
                Each example needs a <strong>Prompt</strong> and <strong>at least one</strong> expected output field
                (Tools, SQL, Messages, Tables, or Chart).
              </p>
              <div className="ex-list">
                {rows.map((row, i) => (
                  <ExampleCard
                    key={i}
                    index={i}
                    row={row}
                    onInput={(f, v) => setInput(i, f, v)}
                    onOutput={(f, v) => setOutput(i, f, v)}
                    onRemove={rows.length > 1 ? () => removeRow(i) : undefined}
                  />
                ))}
              </div>
              <div className="eval-flow-actions">
                <button className="btn btn-ghost" onClick={addRow}>+ Add example</button>
                <button className="btn" disabled={state.busy} onClick={handleUploadExamples}>
                  {state.busy ? 'Uploading…' : 'Upload Examples →'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Run config ──────────────────────────────────── */}
          {state.step === 'run' && (
            <div className="eval-form">
              <div className="eval-field">
                <label>Agent URL *</label>
                <input value={agentUrl} onChange={(e) => setAgentUrl(e.target.value)} placeholder="http://localhost:3000" />
                <span className="eval-hint-inline">Receives POST requests with each example's prompt</span>
              </div>
              <div className="eval-field">
                <label>Agent version</label>
                <input value={agentVersion} onChange={(e) => setAgentVersion(e.target.value)} placeholder="1.0.0" />
              </div>
              <div className="eval-field">
                <label>Metrics <span className="eval-metric-total">({totalSelected} selected)</span></label>
                <div className="eval-metric-groups">
                  <MetricGroup title="SQL"     color={CATEGORY_COLORS['sql']!}     options={SQL_METRIC_OPTIONS}     selected={metricsConfig.sql}     onChange={(id) => toggleMetric('sql', id)} />
                  <MetricGroup title="Chart"   color={CATEGORY_COLORS['chart']!}   options={CHART_METRIC_OPTIONS}   selected={metricsConfig.chart}   onChange={(id) => toggleMetric('chart', id)} />
                  <MetricGroup title="Tool"    color={CATEGORY_COLORS['tool']!}    options={TOOL_METRIC_OPTIONS}    selected={metricsConfig.tool}    onChange={(id) => toggleMetric('tool', id)} />
                  <MetricGroup title="Overall" color={CATEGORY_COLORS['overall']!} options={OVERALL_METRIC_OPTIONS} selected={metricsConfig.overall} onChange={(id) => toggleMetric('overall', id)} />
                </div>
              </div>
              <div className="eval-flow-actions">
                <button className="btn" disabled={state.busy} onClick={handleRun}>
                  {state.busy ? 'Running evaluation…' : '▶ Run Evaluation'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Results ─────────────────────────────────────── */}
          {state.step === 'results' && state.run && (
            <div className="eval-results">
              <div className="eval-run-meta">
                <span className={`badge ${state.run.status === 'completed' ? 'badge-ok' : 'badge-err'}`}>{state.run.status}</span>
                <span className="eval-run-agent">{state.run.agentUrl}</span>
                <span className="eval-run-agent" style={{ marginLeft: 'auto' }}>{state.results.length} examples scored</span>
              </div>
              <div className="eval-results-table-wrap">
                <table className="eval-results-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Agent output</th>
                      {(state.results[0]?.metrics ?? []).map((m: EvalMetricResult) => (
                        <th key={`${m.category}-${m.metric}`}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                            <CategoryBadge category={m.category} />
                            <span>{m.metric.replace(/_/g, ' ')}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {state.results.map((r, i) => (
                      <tr key={r.id}>
                        <td className="eval-row-num">{i + 1}</td>
                        <td className="eval-output-cell">{r.agentOutput}</td>
                        {r.metrics.map((m: EvalMetricResult) => (
                          <td
                            key={`${m.category}-${m.metric}`}
                            style={{ color: scoreColor(m.metric, m.score, m.passed), fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 11, textAlign: 'center' }}
                            title={m.detail}
                          >
                            {m.metric === 'pass_fail' || m.metric.endsWith('_valid') || m.metric.endsWith('_called') || m.metric.endsWith('_correct')
                              ? (m.passed ? 'PASS' : 'FAIL')
                              : m.score.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="eval-flow-actions">
                <button className="btn btn-ghost" onClick={() => {
                  setDatasetName(''); setDatasetDesc(''); setRows([DEFAULT_ROW()]);
                  setAgentUrl('http://localhost:3000'); setAgentVersion('1.0.0');
                  setMetricsConfig(DEFAULT_METRICS);
                  setState({ step: 'dataset', datasetId: '', run: null, results: [], busy: false, error: null });
                }}>New Evaluation</button>
                <button className="btn" onClick={onClose}>Close</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Example Card ─────────────────────────────────────────────────────────────

function ExampleCard({
  index, row, onInput, onOutput, onRemove,
}: {
  index: number;
  row: ExampleRow;
  onInput: (f: keyof ExampleInput, v: string) => void;
  onOutput: (f: keyof ExampleOutput, v: string) => void;
  onRemove?: () => void;
}) {
  const svgRef = useRef<HTMLInputElement>(null);
  const hasOutput = !!outputFilled(row.output);

  function handleSvgFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onOutput('chart', (ev.target?.result as string) ?? '');
    reader.readAsText(file);
  }

  return (
    <div className={`ex-card${!hasOutput && row.input.prompt.trim() ? ' ex-card-warn' : ''}`}>
      <div className="ex-card-header">
        <span className="ex-card-num">Example {index + 1}</span>
        {onRemove && <button className="eval-del-row" onClick={onRemove}>✕</button>}
      </div>

      {/* INPUT */}
      <div className="ex-section-label">
        <span className="ex-section-icon">↳</span> Input
      </div>
      <div className="ex-input-grid">
        <div className="eval-field ex-field-grow">
          <label>Prompt *</label>
          <textarea
            value={row.input.prompt}
            onChange={(e) => onInput('prompt', e.target.value)}
            placeholder="The user message or task sent to the agent"
            rows={3}
          />
        </div>
        <div className="eval-field ex-field-grow">
          <label>Data Sources <span className="ex-optional">(optional)</span></label>
          <textarea
            value={row.input.datasources}
            onChange={(e) => onInput('datasources', e.target.value)}
            placeholder="URLs, file names, DB tables, or context the agent has access to"
            rows={3}
          />
        </div>
      </div>

      {/* OUTPUT */}
      <div className="ex-section-label" style={{ marginTop: 14 }}>
        <span className="ex-section-icon">✓</span> Expected Output
        <span className="ex-section-hint">at least one required</span>
      </div>
      <div className="ex-output-grid">

        <div className="eval-field">
          <label>Tools called</label>
          <input
            value={row.output.tools}
            onChange={(e) => onOutput('tools', e.target.value)}
            placeholder="search_web, run_sql, fetch_page  (comma-separated)"
          />
          {row.output.tools.trim() && (
            <div className="tool-chips">
              {row.output.tools.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
                <span key={t} className="tool-chip">{t}</span>
              ))}
            </div>
          )}
        </div>

        <div className="eval-field">
          <label>SQL</label>
          <textarea
            value={row.output.sql}
            onChange={(e) => onOutput('sql', e.target.value)}
            placeholder="SELECT * FROM orders WHERE …"
            rows={3}
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          />
        </div>

        <div className="eval-field">
          <label>Messages</label>
          <textarea
            value={row.output.messages}
            onChange={(e) => onOutput('messages', e.target.value)}
            placeholder="Expected agent response text"
            rows={3}
          />
        </div>

        <div className="eval-field">
          <label>Tables</label>
          <textarea
            value={row.output.tables}
            onChange={(e) => onOutput('tables', e.target.value)}
            placeholder='[{"col":"val"}]  or  CSV'
            rows={3}
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          />
        </div>

        <div className="eval-field ex-chart-field">
          <label>Chart (SVG)</label>
          <div className="svg-upload-area" onClick={() => svgRef.current?.click()}>
            {row.output.chart ? (
              <span className="svg-upload-ok">
                SVG loaded · {row.output.chart.length.toLocaleString()} chars
                <button className="svg-clear" onClick={(e) => { e.stopPropagation(); onOutput('chart', ''); }}>✕</button>
              </span>
            ) : (
              <span className="svg-upload-prompt">Click to upload .svg</span>
            )}
          </div>
          <input ref={svgRef} type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }} onChange={handleSvgFile} />
          {row.output.chart && (
            <div className="svg-preview" dangerouslySetInnerHTML={{ __html: row.output.chart }} />
          )}
        </div>

      </div>
    </div>
  );
}
// ─── MetricGroup ──────────────────────────────────────────────────────────────

function MetricGroup({
  title,
  color,
  options,
  selected,
  onChange,
}: {
  title: string;
  color: string;
  options: MetricOption[];
  selected: string[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="eval-metric-group">
      <div className="eval-metric-group-header" style={{ color, borderColor: `${color}40` }}>
        <span className="eval-metric-group-dot" style={{ background: color }} />
        {title}
        {selected.length > 0 && (
          <span className="eval-metric-group-count" style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}>
            {selected.length}
          </span>
        )}
      </div>
      <div className="eval-metric-group-list">
        {options.map((opt) => (
          <div
            key={opt.id}
            className={`eval-metric-item${selected.includes(opt.id) ? ' selected' : ''}`}
            title={opt.hint}
            onClick={() => onChange(opt.id)}
          >
            <input
              type="checkbox"
              checked={selected.includes(opt.id)}
              onChange={() => onChange(opt.id)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: 14, height: 14, flexShrink: 0, cursor: 'pointer', marginTop: 2 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>{opt.label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>{opt.hint}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}