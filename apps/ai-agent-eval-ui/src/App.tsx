import { useEffect, useMemo, useState } from 'react';
import { fetchTrace, fetchTraces, fetchTraceEval } from './api';
import type { TraceEvalResult } from './api';
import type { TraceDetail, TraceListItem } from './types';
import SessionsTable, { type SessionGroup } from './components/SessionsTable';
import TracesTable from './components/TracesTable';
import TimelinePanel from './components/TimelinePanel';
import CreateEvalFlow from './components/CreateEvalFlow';
import Dashboard from './components/Dashboard';

const LOOKBACK_OPTIONS = ['1h', '3h', '6h', '12h', '24h'];
const LIMIT_OPTIONS = [20, 50, 100];
const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'ok', label: 'OK' },
  { value: 'error', label: 'Error' },
];

export default function App() {
  const [activePage, setActivePage] = useState<'dashboard' | 'tracing' | 'evaluation'>('dashboard');
  const [showEvalFlow, setShowEvalFlow] = useState(false);
  const [lookback, setLookback] = useState('6h');
  const [limit, setLimit] = useState(50);
  const [refreshToken, setRefreshToken] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [toolFilter, setToolFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
  const [evalResults, setEvalResults] = useState<Map<string, TraceEvalResult>>(new Map());

  useEffect(() => {
    if (activePage !== 'tracing' && activePage !== 'dashboard') return;
    let mounted = true;
    setLoading(true);
    setError(null);
    fetchTraces(lookback, limit)
      .then((data) => {
        if (!mounted) return;
        setTraces(data.traces || []);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load');
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activePage, lookback, limit, refreshToken]);

  const modelOptions = useMemo(() => {
    const models = new Set<string>();
    traces.forEach((trace) => {
      if (trace.model) models.add(trace.model);
    });
    return Array.from(models.values()).sort();
  }, [traces]);

  const toolOptions = useMemo(() => {
    const tools = new Set<string>();
    traces.forEach((trace) => {
      trace.toolCalls.forEach((tool) => tools.add(tool));
    });
    return Array.from(tools.values()).sort();
  }, [traces]);

  const filteredTraces = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return traces.filter((trace) => {
      if (statusFilter !== 'all' && trace.status !== statusFilter) return false;
      if (modelFilter !== 'all' && trace.model !== modelFilter) return false;
      if (toolFilter !== 'all' && !trace.toolCalls.includes(toolFilter)) return false;
      if (!normalizedSearch) return true;
      const haystack = [
        trace.conversationSlug,
        trace.conversationId,
        trace.traceId,
        trace.inputValue,
        trace.model,
        trace.toolCalls.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [modelFilter, searchText, statusFilter, toolFilter, traces]);

  const sessions = useMemo<SessionGroup[]>(() => {
    const map = new Map<string, SessionGroup>();
    filteredTraces.forEach((trace, index) => {
      const id = trace.conversationSlug || trace.conversationId || `anon-${index}`;
      const group = map.get(id) || {
        id,
        slug: trace.conversationSlug,
        traces: [],
        tokens: 0,
        firstTime: trace.startTime,
        lastTime: trace.startTime,
        firstMsg: trace.inputValue || '',
        lastMsg: trace.inputValue || '',
      };
      group.traces.push(trace);
      group.tokens += trace.tokens?.total ?? 0;
      if (trace.startTime < group.firstTime) {
        group.firstTime = trace.startTime;
        group.firstMsg = trace.inputValue || '';
      }
      if (trace.startTime > group.lastTime) {
        group.lastTime = trace.startTime;
        group.lastMsg = trace.inputValue || '';
      }
      map.set(id, group);
    });
    return Array.from(map.values()).sort((a, b) => (a.lastTime < b.lastTime ? 1 : -1));
  }, [filteredTraces]);

  const selectedSession = selectedSessionId ? sessions.find((s) => s.id === selectedSessionId) : null;
  const sessionTraces = useMemo(
    () => selectedSession ? [...selectedSession.traces].sort((a, b) => (a.startTime > b.startTime ? 1 : -1)) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedSessionId, selectedSession?.traces.length],
  );

  // Stable key to detect when the actual set of trace IDs changes
  const sessionTraceKey = sessionTraces.map((t) => t.traceId).join(',');

  // Load saved eval results for visible session traces
  useEffect(() => {
    if (sessionTraces.length === 0) { setEvalResults(new Map()); return; }
    let mounted = true;
    Promise.all(
      sessionTraces.map((t) =>
        fetchTraceEval(t.traceId)
          .then(({ result }) => result ? ([t.traceId, result] as const) : null)
          .catch(() => null),
      ),
    ).then((entries) => {
      if (!mounted) return;
      const map = new Map<string, TraceEvalResult>();
      entries.forEach((e) => { if (e) map.set(e[0], e[1]); });
      setEvalResults(map);
    });
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionTraceKey]);

  useEffect(() => {
    if (selectedSessionId && !sessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(null);
      setSelectedTraceId(null);
      setTraceDetail(null);
    }
  }, [selectedSessionId, sessions]);

  useEffect(() => {
    if (selectedTraceId && !filteredTraces.some((trace) => trace.traceId === selectedTraceId)) {
      setSelectedTraceId(null);
      setTraceDetail(null);
    }
  }, [filteredTraces, selectedTraceId]);

  useEffect(() => {
    if (!selectedTraceId) {
      setTraceDetail(null);
      return;
    }
    let mounted = true;
    fetchTrace(selectedTraceId)
      .then((detail) => {
        if (!mounted) return;
        setTraceDetail(detail);
      })
      .catch(() => {
        if (!mounted) return;
        setTraceDetail(null);
      });
    return () => {
      mounted = false;
    };
  }, [selectedTraceId]);

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-logo">Q</div>
        <button
          className={`sidebar-item${activePage === 'dashboard' ? ' active' : ''}`}
          title="Dashboard"
          onClick={() => setActivePage('dashboard')}
        >
          <span className="sidebar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" aria-label="Dashboard">
              <path
                d="M3 3h8v8H3V3Zm0 10h8v8H3v-8Zm10-10h8v8h-8V3Zm0 10h8v8h-8v-8Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="sidebar-text">Dashboard</span>
        </button>
        <button
          className={`sidebar-item${activePage === 'tracing' ? ' active' : ''}`}
          title="Tracing"
          onClick={() => setActivePage('tracing')}
        >
          <span className="sidebar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" aria-label="Tracing">
              <path
                d="M4 18V6a1 1 0 0 1 2 0v12a1 1 0 0 1-2 0Zm6-2V8a1 1 0 0 1 2 0v8a1 1 0 0 1-2 0Zm6 3V5a1 1 0 0 1 2 0v14a1 1 0 0 1-2 0Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="sidebar-text">Tracing</span>
        </button>
        <button
          className={`sidebar-item${activePage === 'evaluation' ? ' active' : ''}`}
          title="Evaluation"
          onClick={() => setActivePage('evaluation')}
        >
          <span className="sidebar-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img" aria-label="Evaluation">
              <path
                d="M6 4h9l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm8 1.5V8h2.5L14 5.5ZM8 11h8v2H8v-2Zm0 4h8v2H8v-2Zm0-8h4v2H8V7Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="sidebar-text">Evaluation</span>
        </button>
      </nav>
      <div className="content">
        {activePage === 'dashboard' ? (
          <>
            <div className="page-header">
              <div className="page-title">Dashboard</div>
              <div className="page-subtitle">Overall performance · last {lookback}</div>
            </div>
            <div className="filter-bar" style={{ marginBottom: 0 }}>
              <div className="filter-group">
                <div className="filter-field">
                  <label>Lookback</label>
                  <select value={lookback} onChange={(e) => setLookback(e.target.value)}>
                    {LOOKBACK_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-field">
                  <label>Limit</label>
                  <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                    {LIMIT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div className="filter-actions">
                  <button className="btn" onClick={() => setRefreshToken((v) => v + 1)}>Refresh</button>
                </div>
              </div>
            </div>
            <Dashboard traces={traces} loading={loading} lookback={lookback} />
          </>
        ) : activePage === 'evaluation' ? (
          <div className="eval-page">
            <div className="page-header">
              <div className="page-title">Evaluation</div>
              <div className="page-subtitle">Quality scoring and regression tracking</div>
            </div>
            <div className="eval-center">
              <div className="eval-grid">
                <div className="eval-card">
                <div className="eval-icon eval-agent" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-6 16a6 6 0 0 1 12 0H6Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <div>
                  <div className="eval-title">Agent as a Judge</div>
                  <div className="eval-subtitle">LLM rubric scoring</div>
                </div>
              </div>
                <div className="eval-card">
                <div className="eval-icon eval-code" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M9 18 3 12l6-6 1.4 1.4L5.8 12l4.6 4.6L9 18Zm6 0-1.4-1.4L18.2 12l-4.6-4.6L15 6l6 6-6 6Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <div>
                  <div className="eval-title">Code Based</div>
                  <div className="eval-subtitle">Executable checks</div>
                </div>
              </div>
                <div className="eval-card eval-card-center eval-card-clickable" onClick={() => setShowEvalFlow(true)}>
                <div className="eval-icon eval-ground" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M4 11h16v2H4v-2Zm2-6h12v2H6V5Zm0 12h12v2H6v-2Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <div>
                  <div className="eval-title">Ground Truth</div>
                  <div className="eval-subtitle">Golden answers</div>
                </div>
              </div>
                <div className="eval-card">
                <div className="eval-icon eval-human" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M7 20v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2H7Zm5-16a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <div>
                  <div className="eval-title">Human Annotation</div>
                  <div className="eval-subtitle">Reviewer labeling</div>
                </div>
              </div>
                <div className="eval-card">
                <div className="eval-icon eval-feedback" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <div>
                  <div className="eval-title">User Feedback</div>
                  <div className="eval-subtitle">Thumbs + comments</div>
                </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
        <div className="page-header">
          <div className="page-title">Tracing</div>
          <div className="page-subtitle">Agent execution traces · OpenTelemetry</div>
        </div>
        <div className="tabs">
          <div className="tab active">Conversations</div>
        </div>
        <div className="filter-bar">
          <div className="filter-group">
            <div className="filter-field">
              <label>Search</label>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search conversation, input, trace, tool"
              />
            </div>
            <div className="filter-field">
              <label>Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label>Model</label>
              <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}>
                <option value="all">All</option>
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label>Tool</label>
              <select value={toolFilter} onChange={(e) => setToolFilter(e.target.value)}>
                <option value="all">All</option>
                {toolOptions.map((tool) => (
                  <option key={tool} value={tool}>
                    {tool}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="filter-group">
            <div className="filter-field">
              <label>Lookback</label>
              <select value={lookback} onChange={(e) => setLookback(e.target.value)}>
                {LOOKBACK_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label>Limit</label>
              <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                {LIMIT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-actions">
              <button className="btn" onClick={() => setRefreshToken((value) => value + 1)}>
                Refresh
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setSearchText('');
                  setStatusFilter('all');
                  setModelFilter('all');
                  setToolFilter('all');
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : error ? (
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error}
          </div>
        ) : (
          <>
            <div className="filter-summary">
              <span>
                Showing {filteredTraces.length} of {traces.length} traces
              </span>
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{sessions.length}</div>
                <div className="stat-label">Conversations</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{filteredTraces.length}</div>
                <div className="stat-label">Traces</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{filteredTraces.reduce((sum, t) => sum + t.spanCount, 0)}</div>
                <div className="stat-label">Spans</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{filteredTraces.reduce((sum, t) => sum + (t.tokens?.total ?? 0), 0)}</div>
                <div className="stat-label">Tokens</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{filteredTraces.filter((t) => t.status === 'error').length}</div>
                <div className="stat-label">Errors</div>
              </div>
            </div>
            <SessionsTable sessions={sessions} onSelect={(id) => {
              setSelectedSessionId(id);
              setSelectedTraceId(null);
            }} />
            {selectedSession ? (
              <div style={{ marginTop: 16 }}>
                <TracesTable
                  traces={sessionTraces}
                  onSelect={(traceId) => setSelectedTraceId(traceId)}
                  evalResults={evalResults.size > 0 ? evalResults : undefined}
                />
              </div>
            ) : null}
          </>
        )}
          </>
        )}
      </div>
      <div className={`panel${traceDetail ? ' open' : ''}`}>
        {traceDetail ? (
          <TimelinePanel
            detail={traceDetail}
            onClose={() => {
              setTraceDetail(null);
              setSelectedTraceId(null);
            }}
          />
        ) : null}
      </div>
      {showEvalFlow && <CreateEvalFlow onClose={() => setShowEvalFlow(false)} />}
      <div className={`panel-overlay${traceDetail ? ' open' : ''}`} onClick={() => {
        setTraceDetail(null);
        setSelectedTraceId(null);
      }} />
    </div>
  );
}
