import { useMemo, useState } from 'react';
import type { TraceListItem } from '../types';
import { DonutChart, VerticalBarChart, AreaChart, PALETTE } from './charts';
import type { PieSlice, BarItem } from './charts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtK(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

// ─── Static bucket definitions ────────────────────────────────────────────────

const LATENCY_BUCKETS = [
  { label: '< 500ms',  min: 0,    max: 500,      color: '#1a7a4a' },
  { label: '500ms–1s', min: 500,  max: 1000,     color: '#4a7a1a' },
  { label: '1s – 3s',  min: 1000, max: 3000,     color: '#7a5c00' },
  { label: '3s – 5s',  min: 3000, max: 5000,     color: '#c07800' },
  { label: '> 5s',     min: 5000, max: Infinity,  color: '#c0392b' },
];

const TOKEN_BUCKETS = [
  { label: '0–500',   min: 0,     max: 500   },
  { label: '500–2k',  min: 500,   max: 2000  },
  { label: '2k–5k',   min: 2000,  max: 5000  },
  { label: '5k–10k',  min: 5000,  max: 10000 },
  { label: '10k+',    min: 10000, max: Infinity },
];

const SPAN_BUCKETS = [
  { label: '1–5',   min: 1,  max: 6        },
  { label: '6–10',  min: 6,  max: 11       },
  { label: '11–20', min: 11, max: 21       },
  { label: '21–50', min: 21, max: 51       },
  { label: '50+',   min: 51, max: Infinity },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type ModelStat = {
  model: string; count: number; errorRate: number;
  avgMs: number; p95: number; avgTokens: number;
};

type ModelsMetric = 'count' | 'latency' | 'p95' | 'tokens' | 'errors';

const MODELS_METRICS: {
  key: ModelsMetric; label: string;
  value: (m: ModelStat) => number;
  format: (v: number) => string;
  color: string;
}[] = [
  { key: 'count',   label: 'Trace Count', value: (m) => m.count,     format: (v) => String(v), color: 'var(--blue)'  },
  { key: 'latency', label: 'Avg Latency', value: (m) => m.avgMs,     format: fmtMs,            color: 'var(--green)' },
  { key: 'p95',     label: 'p95 Latency', value: (m) => m.p95,       format: fmtMs,            color: 'var(--amber)' },
  { key: 'tokens',  label: 'Avg Tokens',  value: (m) => m.avgTokens, format: fmtK,             color: 'var(--blue)'  },
  { key: 'errors',  label: 'Error Rate',  value: (m) => m.errorRate, format: (v) => v.toFixed(1) + '%', color: 'var(--red)' },
];

// ─── ViewToggle ───────────────────────────────────────────────────────────────

function ViewToggle<T extends string>({
  options, value, onChange,
}: {
  options: { key: T; icon: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="dash-view-toggle">
      {options.map((o) => (
        <button
          key={o.key}
          className={`dash-view-btn${value === o.key ? ' active' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  traces: TraceListItem[];
  loading: boolean;
  lookback: string;
};

export default function Dashboard({ traces, loading, lookback }: Props) {
  // ── view-type state per section ──────────────────────────────────────────────
  const [latencyView, setLatencyView]   = useState<'bars' | 'column' | 'pie'>('bars');
  const [toolsView, setToolsView]       = useState<'bars' | 'pie'>('bars');
  const [modelsView, setModelsView]     = useState<'table' | 'bar' | 'pie'>('table');
  const [modelsMetric, setModelsMetric] = useState<ModelsMetric>('count');
  const [tokenView, setTokenView]       = useState<'bars' | 'column'>('bars');

  // ── derived data ─────────────────────────────────────────────────────────────

  const summary = useMemo(() => {
    if (traces.length === 0) return null;
    const sorted = [...traces.map((t) => t.durationMs)].sort((a, b) => a - b);
    const errors = traces.filter((t) => t.status === 'error').length;
    const totalTokens = traces.reduce((s, t) => s + (t.tokens?.total ?? 0), 0);
    return {
      total: traces.length,
      errors,
      successRate: ((traces.length - errors) / traces.length) * 100,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      totalTokens,
      avgTokens: Math.round(totalTokens / traces.length),
    };
  }, [traces]);

  const modelStats = useMemo<ModelStat[]>(() => {
    const map = new Map<string, { count: number; errors: number; totalMs: number; totalTokens: number; durations: number[] }>();
    traces.forEach((t) => {
      const key = t.model || '(unknown)';
      const cur = map.get(key) ?? { count: 0, errors: 0, totalMs: 0, totalTokens: 0, durations: [] };
      cur.count++;
      if (t.status === 'error') cur.errors++;
      cur.totalMs += t.durationMs;
      cur.totalTokens += t.tokens?.total ?? 0;
      cur.durations.push(t.durationMs);
      map.set(key, cur);
    });
    return Array.from(map.entries())
      .map(([model, s]) => {
        const sorted = [...s.durations].sort((a, b) => a - b);
        return {
          model,
          count: s.count,
          errorRate: s.count ? (s.errors / s.count) * 100 : 0,
          avgMs: s.count ? s.totalMs / s.count : 0,
          p95: percentile(sorted, 95),
          avgTokens: s.count ? Math.round(s.totalTokens / s.count) : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [traces]);

  const toolStats = useMemo(() => {
    const map = new Map<string, number>();
    traces.forEach((t) => t.toolCalls.forEach((tool) => map.set(tool, (map.get(tool) ?? 0) + 1)));
    return Array.from(map.entries())
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [traces]);

  const latencyBuckets = useMemo(
    () => LATENCY_BUCKETS.map((b) => ({
      ...b,
      count: traces.filter((t) => t.durationMs >= b.min && t.durationMs < b.max).length,
    })),
    [traces],
  );

  const tokenBuckets = useMemo(
    () => TOKEN_BUCKETS.map((b) => ({
      label: b.label,
      count: traces.filter((t) => (t.tokens?.total ?? 0) >= b.min && (t.tokens?.total ?? 0) < b.max).length,
    })),
    [traces],
  );

  const spanBuckets = useMemo(
    () => SPAN_BUCKETS.map((b) => ({
      label: b.label,
      count: traces.filter((t) => t.spanCount >= b.min && t.spanCount < b.max).length,
    })),
    [traces],
  );

  const volumeOverTime = useMemo(() => {
    const lookbackHours = parseInt(lookback, 10);
    const bucketMinutes =
      lookbackHours <= 1 ? 5 : lookbackHours <= 3 ? 15 : lookbackHours <= 6 ? 30 : lookbackHours <= 12 ? 60 : 120;
    const numBuckets = Math.round((lookbackHours * 60) / bucketMinutes);
    const now = Date.now();
    const startMs = now - lookbackHours * 3600 * 1000;
    const buckets = Array.from({ length: numBuckets }, (_, i) => ({
      label: new Date(startMs + i * bucketMinutes * 60 * 1000).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', hour12: false,
      }),
      count: 0, errors: 0,
    }));
    traces.forEach((t) => {
      const idx = Math.floor((new Date(t.startTime).getTime() - startMs) / (bucketMinutes * 60 * 1000));
      if (idx >= 0 && idx < numBuckets) {
        buckets[idx]!.count++;
        if (t.status === 'error') buckets[idx]!.errors++;
      }
    });
    return buckets.map((b) => ({ label: b.label, values: [b.count, b.errors] }));
  }, [traces, lookback]);

  // ── derived chart data ────────────────────────────────────────────────────────

  const latencyPieSlices = useMemo<PieSlice[]>(
    () => latencyBuckets.map((b) => ({ label: b.label, value: b.count, color: b.color })),
    [latencyBuckets],
  );
  const toolPieSlices = useMemo<PieSlice[]>(
    () => toolStats.map((t, i) => ({ label: t.tool, value: t.count, color: PALETTE[i % PALETTE.length]! })),
    [toolStats],
  );
  const modelPieSlices = useMemo<PieSlice[]>(
    () => modelStats.map((m, i) => ({ label: m.model, value: m.count, color: PALETTE[i % PALETTE.length]! })),
    [modelStats],
  );
  const modelsBarData = useMemo<BarItem[]>(() => {
    const cfg = MODELS_METRICS.find((m) => m.key === modelsMetric)!;
    return modelStats.map((m) => ({ label: m.model, value: cfg.value(m) }));
  }, [modelStats, modelsMetric]);

  const modelsBarCfg = MODELS_METRICS.find((m) => m.key === modelsMetric)!;
  const maxLatency = Math.max(...latencyBuckets.map((b) => b.count), 1);
  const maxTool    = Math.max(toolStats[0]?.count ?? 1, 1);
  const maxToken   = Math.max(...tokenBuckets.map((b) => b.count), 1);

  // ── early returns ─────────────────────────────────────────────────────────────

  if (loading) return <div className="empty-state">Loading…</div>;
  if (traces.length === 0)
    return <div className="empty-state">No trace data for the last {lookback}. Try extending the lookback window.</div>;
  if (!summary) return null;

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div className="dashboard">

      {/* ── KPI row ─────────────────────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{summary.total}</div>
          <div className="stat-label">Total Traces</div>
        </div>
        <div className="stat-card">
          <div
            className="stat-value"
            style={{ color: summary.successRate >= 90 ? 'var(--green)' : summary.successRate >= 70 ? 'var(--amber)' : 'var(--red)' }}
          >
            {summary.successRate.toFixed(1)}%
          </div>
          <div className="stat-label">Success Rate</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtMs(summary.p50)}</div>
          <div className="stat-label">p50 Latency</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtMs(summary.p95)}</div>
          <div className="stat-label">p95 Latency</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{fmtMs(summary.p99)}</div>
          <div className="stat-label">p99 Latency</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{summary.avgTokens.toLocaleString()}</div>
          <div className="stat-label">Avg Tokens / Trace</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: summary.errors > 0 ? 'var(--red)' : 'var(--green)' }}>
            {summary.errors}
          </div>
          <div className="stat-label">Errors ({lookback})</div>
        </div>
      </div>

      {/* ── Volume over time + Status breakdown ─────────────────────────── */}
      <div className="dash-grid dash-grid-3-1">
        <div className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title">Volume over time</div>
          </div>
          <AreaChart
            points={volumeOverTime}
            series={[
              { label: 'Traces', color: 'var(--blue)',  fillOpacity: 0.12 },
              { label: 'Errors', color: 'var(--red)',   fillOpacity: 0.08, dashed: true },
            ]}
            height={150}
          />
        </div>
        <div className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title">Status breakdown</div>
          </div>
          <DonutChart
            slices={[
              { label: 'OK',    value: summary.total - summary.errors, color: 'var(--green)' },
              { label: 'Error', value: summary.errors,                  color: 'var(--red)'   },
            ]}
            size={120}
          />
        </div>
      </div>

      {/* ── Latency + Tools ─────────────────────────────────────────────── */}
      <div className="dash-grid">
        <div className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title">Latency Distribution</div>
            <ViewToggle
              options={[
                { key: 'bars' as const,   icon: '≡ Bars'  },
                { key: 'column' as const, icon: '▐ Chart' },
                { key: 'pie' as const,    icon: '◉ Pie'   },
              ]}
              value={latencyView}
              onChange={setLatencyView}
            />
          </div>
          {latencyView === 'bars' && (
            <div className="dash-bars">
              {latencyBuckets.map((b) => (
                <div key={b.label} className="dash-bar-row">
                  <div className="dash-bar-label">{b.label}</div>
                  <div className="dash-bar-track">
                    <div className="dash-bar-fill" style={{ width: `${(b.count / maxLatency) * 100}%`, background: b.color }} />
                  </div>
                  <div className="dash-bar-count">{b.count}</div>
                </div>
              ))}
            </div>
          )}
          {latencyView === 'column' && (
            <VerticalBarChart
              data={latencyBuckets.map((b) => ({ label: b.label, value: b.count }))}
              color="var(--blue)"
              height={180}
            />
          )}
          {latencyView === 'pie' && <DonutChart slices={latencyPieSlices} size={130} />}
        </div>

        <div className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title">Top Tools</div>
            <ViewToggle
              options={[
                { key: 'bars' as const, icon: '≡ Bars' },
                { key: 'pie' as const,  icon: '◉ Pie'  },
              ]}
              value={toolsView}
              onChange={setToolsView}
            />
          </div>
          {toolStats.length === 0 ? (
            <div className="dash-no-data">No tool calls recorded</div>
          ) : toolsView === 'bars' ? (
            <div className="dash-bars">
              {toolStats.map((t) => (
                <div key={t.tool} className="dash-bar-row">
                  <div className="dash-bar-label" title={t.tool}>{t.tool}</div>
                  <div className="dash-bar-track">
                    <div className="dash-bar-fill dash-bar-green" style={{ width: `${(t.count / maxTool) * 100}%` }} />
                  </div>
                  <div className="dash-bar-count">{t.count}</div>
                </div>
              ))}
            </div>
          ) : (
            <DonutChart slices={toolPieSlices} size={130} />
          )}
        </div>
      </div>

      {/* ── Token + Span distribution ────────────────────────────────────── */}
      <div className="dash-grid">
        <div className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title">Token Distribution</div>
            <ViewToggle
              options={[
                { key: 'bars' as const,   icon: '≡ Bars'  },
                { key: 'column' as const, icon: '▐ Chart' },
              ]}
              value={tokenView}
              onChange={setTokenView}
            />
          </div>
          {tokenView === 'bars' ? (
            <div className="dash-bars">
              {tokenBuckets.map((b) => (
                <div key={b.label} className="dash-bar-row">
                  <div className="dash-bar-label">{b.label}</div>
                  <div className="dash-bar-track">
                    <div className="dash-bar-fill dash-bar-blue" style={{ width: `${(b.count / maxToken) * 100}%` }} />
                  </div>
                  <div className="dash-bar-count">{b.count}</div>
                </div>
              ))}
            </div>
          ) : (
            <VerticalBarChart
              data={tokenBuckets.map((b) => ({ label: b.label, value: b.count }))}
              color="var(--blue)"
              height={160}
            />
          )}
        </div>

        <div className="dash-section">
          <div className="dash-section-header">
            <div className="dash-section-title">Span Count Distribution</div>
          </div>
          <VerticalBarChart
            data={spanBuckets.map((b) => ({ label: b.label, value: b.count }))}
            color="var(--amber)"
            height={160}
          />
        </div>
      </div>

      {/* ── Models ──────────────────────────────────────────────────────── */}
      <div className="dash-section">
        <div className="dash-section-header">
          <div className="dash-section-title">Models</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {modelsView === 'bar' && (
              <select
                value={modelsMetric}
                onChange={(e) => setModelsMetric(e.target.value as ModelsMetric)}
                className="dash-metric-select"
              >
                {MODELS_METRICS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            )}
            <ViewToggle
              options={[
                { key: 'table' as const, icon: '⊞ Table' },
                { key: 'bar' as const,   icon: '▐ Chart'  },
                { key: 'pie' as const,   icon: '◉ Pie'    },
              ]}
              value={modelsView}
              onChange={setModelsView}
            />
          </div>
        </div>

        {modelsView === 'table' && (
          <table className="dash-table">
            <thead>
              <tr>
                <th>Model</th><th>Traces</th><th>Avg Latency</th>
                <th>p95 Latency</th><th>Avg Tokens</th><th>Error Rate</th>
              </tr>
            </thead>
            <tbody>
              {modelStats.map((m) => (
                <tr key={m.model}>
                  <td className="dash-model-name">{m.model}</td>
                  <td>{m.count}</td>
                  <td>{fmtMs(m.avgMs)}</td>
                  <td>{fmtMs(m.p95)}</td>
                  <td>{m.avgTokens.toLocaleString()}</td>
                  <td style={{ color: m.errorRate > 10 ? 'var(--red)' : m.errorRate > 0 ? 'var(--amber)' : 'var(--green)', fontWeight: 600 }}>
                    {m.errorRate.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {modelsView === 'bar' && (
          <VerticalBarChart
            data={modelsBarData}
            formatValue={modelsBarCfg.format}
            color={modelsBarCfg.color}
            height={220}
          />
        )}

        {modelsView === 'pie' && <DonutChart slices={modelPieSlices} size={150} />}
      </div>
    </div>
  );
}
