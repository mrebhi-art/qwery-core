import type { TraceEvalResult } from '../api';
import type { TraceListItem } from '../types';

export type TracesTableProps = {
  traces: TraceListItem[];
  onSelect: (traceId: string) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (traceId: string) => void;
  evalResults?: Map<string, TraceEvalResult>;
};

function formatDuration(ms: number) {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function evalBadgeClass(score: number) {
  if (score >= 0.8) return 'eval-badge eval-badge-pass';
  if (score >= 0.5) return 'eval-badge eval-badge-mid';
  return 'eval-badge eval-badge-fail';
}

function categoryScore(result: TraceEvalResult, category: string): number | null {
  const ms = result.metrics.filter((m) => m.category === category);
  if (ms.length === 0) return null;
  return ms.reduce((sum, m) => sum + m.score, 0) / ms.length;
}

function CategoryBadge({ result, category }: { result: TraceEvalResult; category: string }) {
  const score = categoryScore(result, category);
  if (score === null) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>--</span>;
  return <span className={evalBadgeClass(score)}>{Math.round(score * 100)}%</span>;
}

export default function TracesTable({ traces, onSelect, selectedIds, onToggleSelect, evalResults }: TracesTableProps) {
  if (traces.length === 0) {
    return <div className="empty-state">Select a conversation.</div>;
  }

  const selectable = !!onToggleSelect;

  return (
    <table className="data-table">
      <thead>
        <tr>
          {selectable && <th style={{ width: 32 }}></th>}
          <th>#</th>
          <th>Time</th>
          <th>Input</th>
          <th>Model</th>
          <th>Spans</th>
          <th>Duration</th>
          <th>Tokens</th>
          <th>Tools</th>
          <th>Status</th>
          {evalResults && <th>SQL</th>}
          {evalResults && <th>Chart</th>}
          {evalResults && <th>Score</th>}
        </tr>
      </thead>
      <tbody>
        {traces.map((trace, index) => {
          const tools = trace.toolCalls.length
            ? trace.toolCalls.map((tool) => (
                <span key={tool} className="badge badge-tool">
                  {tool}
                </span>
              ))
            : '--';
          const isSelected = selectedIds?.has(trace.traceId) ?? false;
          return (
            <tr
              key={trace.traceId}
              onClick={() => onSelect(trace.traceId)}
              style={isSelected ? { background: 'var(--accent-dim)' } : undefined}
            >
              {selectable && (
                <td
                  onClick={(e) => { e.stopPropagation(); onToggleSelect!(trace.traceId); }}
                  style={{ textAlign: 'center', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect!(trace.traceId)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: 'pointer' }}
                  />
                </td>
              )}
              <td className="mono">{index + 1}</td>
              <td className="mono">{new Date(trace.startTime).toLocaleTimeString()}</td>
              <td style={{ maxWidth: 200, color: 'var(--text-secondary)' }}>{trace.inputValue.slice(0, 50)}</td>
              <td className="mono" style={{ color: 'var(--amber)' }}>
                {trace.model || '--'}
              </td>
              <td className="mono">{trace.spanCount}</td>
              <td className="mono">{formatDuration(trace.durationMs)}</td>
              <td className="mono">{trace.tokens?.total ?? 0}</td>
              <td>{tools}</td>
              <td>
                {trace.status === 'error' ? (
                  <span className="badge badge-err">Error</span>
                ) : (
                  <span className="badge badge-ok">OK</span>
                )}
              </td>
              {evalResults && (
                <td style={{ textAlign: 'center' }}>
                  {(() => { const r = evalResults.get(trace.traceId); return r ? <CategoryBadge result={r} category="sql" /> : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>--</span>; })()}
                </td>
              )}
              {evalResults && (
                <td style={{ textAlign: 'center' }}>
                  {(() => { const r = evalResults.get(trace.traceId); return r ? <CategoryBadge result={r} category="chart" /> : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>--</span>; })()}
                </td>
              )}
              {evalResults && (
                <td style={{ textAlign: 'center' }}>
                  {(() => {
                    const r = evalResults.get(trace.traceId);
                    if (!r) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>--</span>;
                    return (
                      <span className={evalBadgeClass(r.score)}>
                        {r.passed ? '✓' : '✗'} {Math.round(r.score * 100)}%
                      </span>
                    );
                  })()}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
