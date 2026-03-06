import { Hono } from 'hono';
import type { GetTraceUseCase } from '../../application/use-cases/get-trace.use-case';
import type { ListTracesUseCase } from '../../application/use-cases/list-traces.use-case';
import { TraceNotFoundError } from '../../application/errors';
import type { Trace, StepType, TraceId } from '../../domain/trace';

// ─── Types matching the dashboard's expected wire format ─────────────────────

type DashboardSpan = {
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  startTimeUs: number;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, string>;
  events: Array<{ name: string; timestamp: string }>;
};

type DashboardTraceListItem = {
  traceId: string;
  conversationId: string;
  conversationSlug: string;
  startTime: string;
  inputValue: string;
  model: string;
  spanCount: number;
  durationMs: number;
  status: 'ok' | 'error';
  tokens: { total: number };
  toolCalls: string[];
};

type DashboardTraceDetail = {
  traceId: string;
  spanCount: number;
  rootOperation: string;
  spans: DashboardSpan[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseLookback(lookback: string): number {
  const m = lookback.match(/^(\d+)(m|h|d)$/);
  if (!m) return 6 * 3_600_000;
  const n = Number(m[1]);
  if (m[2] === 'm') return n * 60_000;
  if (m[2] === 'h') return n * 3_600_000;
  if (m[2] === 'd') return n * 86_400_000;
  return 6 * 3_600_000;
}

function stringify(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

const STEP_KIND: Record<StepType, string> = {
  llm_call: 'llm',
  tool_call: 'tool',
  retrieval: 'retriever',
  reasoning: 'agent',
  custom: 'agent',
};

// ─── Domain → Dashboard adapters ─────────────────────────────────────────────

function toListItem(trace: Trace): DashboardTraceListItem {
  const convId = String(trace.metadata['conversationId'] ?? trace.projectId);
  const convSlug = String(trace.metadata['conversationSlug'] ?? trace.projectId);
  return {
    traceId: trace.id,
    conversationId: convId,
    conversationSlug: convSlug,
    startTime: trace.startedAt.toISOString(),
    inputValue: stringify(trace.input),
    model: trace.modelName,
    spanCount: trace.steps.length + 1,
    durationMs: trace.totalLatencyMs,
    status: trace.status === 'failed' ? 'error' : 'ok',
    tokens: { total: trace.totalTokenUsage.totalTokens },
    toolCalls: trace.steps.filter((s) => s.type === 'tool_call').map((s) => s.name),
  };
}

function toSpanDetail(trace: Trace): DashboardTraceDetail {
  const rootSpan: DashboardSpan = {
    spanId: trace.id,
    parentSpanId: null,
    operationName: 'agent.run',
    startTimeUs: trace.startedAt.getTime() * 1000,
    durationMs: 1,
    status: trace.status === 'failed' ? 'error' : 'ok',
    attributes: {
      'openinference.span.kind': 'agent',
      'agent.id': trace.projectId,
      'llm.model_name': trace.modelName,
      'agent.version': trace.agentVersion,
      'input.value': stringify(trace.input),
      'output.value': stringify(trace.output),
    },
    events: trace.error
      ? [{ name: 'error', timestamp: (trace.endedAt ?? trace.startedAt).toISOString() }]
      : [],
  };

  const baseStartUs = trace.startedAt.getTime() * 1000;
  let cursorMs = 0;
  const orderedSteps = [...trace.steps].sort(
    (a, b) => a.sequence - b.sequence,
  );

  const stepSpans: DashboardSpan[] = orderedSteps.map((step) => {
    const operationName =
      step.type === 'llm_call'
        ? 'llm.call'
        : step.type === 'tool_call'
          ? `tool.${step.name}`
          : step.type === 'retrieval'
            ? `retrieval.${step.name}`
            : step.name;

    const normalizedDurationMs =
      step.type === 'custom' && step.name === 'query'
        ? 1
        : Math.max(1, Math.round(step.latencyMs));
    const startTimeUs = baseStartUs + cursorMs * 1000;
    cursorMs += normalizedDurationMs;

    const customKind =
      step.type === 'custom' && (step.name === 'datasources' || step.name === 'tools')
        ? 'retriever'
        : STEP_KIND[step.type] ?? 'chain';
    const attributes: Record<string, string> = {
      'openinference.span.kind': customKind,
      'input.value': stringify(step.input),
      'output.value': stringify(step.output),
    };
    if (step.type === 'llm_call') attributes['llm.model_name'] = step.name;
    if (step.tokenUsage) {
      attributes['llm.token_count.prompt'] = String(step.tokenUsage.promptTokens);
      attributes['llm.token_count.completion'] = String(step.tokenUsage.completionTokens);
      attributes['llm.token_count.total'] = String(step.tokenUsage.totalTokens);
    }
    if (step.artifacts && step.artifacts.length > 0) {
      attributes['artifacts'] = JSON.stringify(step.artifacts);
    }
    for (const [k, v] of Object.entries(step.metadata)) attributes[k] = String(v);

    return {
      spanId: step.id,
      parentSpanId: trace.id,
      operationName,
      startTimeUs,
      durationMs: normalizedDurationMs,
      status: step.error ? 'error' : 'ok',
      attributes,
      events: step.error
        ? [{ name: 'error', timestamp: step.endedAt.toISOString() }]
        : [],
    };
  });

  return {
    traceId: trace.id,
    spanCount: stepSpans.length + 1,
    rootOperation: trace.projectId,
    spans: [rootSpan, ...stepSpans],
  };
}

// ─── Dashboard HTML ───────────────────────────────────────────────────────────

/* eslint-disable max-len */
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Qwery · Tracing</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#ffffff;--bg-card:#f8f8f8;--bg-elevated:#f0f0f0;--bg-hover:#ebebeb;--bg-active:#e0e0e0;
  --border:#d4d4d4;--border-hover:#b0b0b0;--border-focus:#111111;
  --text:#111111;--text-secondary:#444444;--text-muted:#888888;
  --accent:#111111;--accent-light:#333333;--accent-dim:rgba(0,0,0,.06);--accent-glow:rgba(0,0,0,.15);
  --green:#1a7a4a;--green-dim:rgba(26,122,74,.08);
  --red:#c0392b;--red-dim:rgba(192,57,43,.08);
  --amber:#7a5c00;--amber-dim:rgba(122,92,0,.08);
  --blue:#1a4a7a;--blue-dim:rgba(26,74,122,.08);
  --purple:#4a1a7a;--purple-dim:rgba(74,26,122,.08);
  --pink:#7a1a4a;--pink-dim:rgba(122,26,74,.08);
  --cyan:#1a6a7a;--cyan-dim:rgba(26,106,122,.08);
  --mono:'JetBrains Mono','SF Mono',monospace;--sans:'Inter',system-ui,-apple-system,sans-serif;
  --radius:10px;--radius-sm:6px;--shadow:0 2px 8px rgba(0,0,0,.08),0 0 1px rgba(0,0,0,.12);
}
html{font-size:14px}
body{font-family:var(--sans);background:var(--bg);color:var(--text);display:flex;min-height:100vh;-webkit-font-smoothing:antialiased;line-height:1.5}
a{color:var(--accent-light);text-decoration:none;transition:color .15s}
a:hover{color:#a5b4fc}
::selection{background:var(--accent);color:#fff}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--border-hover)}
.sidebar{width:56px;background:var(--bg-card);border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:14px 0;position:fixed;top:0;left:0;height:100vh;z-index:100}
.sidebar-logo{width:32px;height:32px;border-radius:8px;background:#111111;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;margin-bottom:20px;letter-spacing:-.3px}
.sidebar-nav{display:flex;flex-direction:column;gap:4px}
.nav-btn{width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);position:relative;border:none;background:none;transition:all .15s}
.nav-btn:hover{background:var(--bg-hover);color:var(--text-secondary)}
.nav-btn.active{background:var(--accent-dim);color:var(--accent)}
.nav-btn svg{width:18px;height:18px}
.nav-btn .tooltip{position:absolute;left:48px;background:var(--bg-elevated);color:var(--text);padding:5px 10px;border-radius:var(--radius-sm);font-size:11px;font-weight:500;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s;border:1px solid var(--border);box-shadow:var(--shadow);z-index:200}
.nav-btn:hover .tooltip{opacity:1}
.sidebar-footer{margin-top:auto;display:flex;flex-direction:column;gap:6px;align-items:center}
.sidebar-footer select,.sidebar-footer button{width:40px;background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-sm);font-family:var(--sans);font-size:10px;cursor:pointer;transition:all .15s}
.sidebar-footer select{padding:3px 1px;text-align:center}
.sidebar-footer button{height:28px;font-size:12px}
.sidebar-footer select:hover,.sidebar-footer button:hover{border-color:var(--border-hover);color:var(--text)}
.content{margin-left:56px;flex:1;padding:20px 24px;min-height:100vh}
.page-header{margin-bottom:20px}
.page-title-row{display:flex;align-items:center;gap:10px;margin-bottom:2px}
.page-title{font-size:20px;font-weight:700;letter-spacing:-.4px}
.live-badge{font-size:9px;font-weight:700;color:var(--green);background:var(--green-dim);border:1px solid rgba(16,185,129,.2);padding:2px 8px;border-radius:20px;letter-spacing:.5px;text-transform:uppercase;display:flex;align-items:center;gap:4px}
.live-badge::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.page-subtitle{font-size:12px;color:var(--text-muted)}
.tabs{display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid var(--border)}
.tab{padding:8px 16px;font-size:12px;font-weight:600;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;transition:all .15s}
.tab:hover{color:var(--text-secondary)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-content{display:none}.tab-content.active{display:block}
.breadcrumb{font-size:11px;color:var(--text-muted);margin-bottom:10px;display:flex;align-items:center;gap:5px}
.breadcrumb a{font-weight:500}
.breadcrumb .sep{color:var(--text-muted);font-size:10px}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px}
.stat-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;transition:all .2s}
.stat-card:hover{border-color:var(--border-hover);transform:translateY(-1px);box-shadow:var(--shadow)}
.stat-value{font-size:20px;font-weight:700;letter-spacing:-.3px}
.stat-label{font-size:10px;color:var(--text-muted);margin-top:2px;text-transform:uppercase;letter-spacing:.6px;font-weight:600}
.data-table{width:100%;border-collapse:separate;border-spacing:0;background:var(--bg-card);border-radius:var(--radius);overflow:hidden;border:1px solid var(--border)}
.data-table th{background:var(--bg);color:var(--text-muted);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;padding:10px 14px;text-align:left;white-space:nowrap;border-bottom:1px solid var(--border)}
.data-table td{padding:10px 14px;border-top:1px solid var(--border);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;transition:background .1s}
.data-table tr{cursor:pointer}
.data-table tbody tr:hover td{background:var(--bg-hover)}
.mono{font-family:var(--mono);font-size:11px;color:var(--text-secondary)}
.badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:.3px}
.badge-ok{background:var(--green-dim);color:var(--green);border:1px solid rgba(16,185,129,.15)}
.badge-err{background:var(--red-dim);color:var(--red);border:1px solid rgba(239,68,68,.15)}
.badge-tool{background:var(--blue-dim);color:var(--blue);border:1px solid rgba(59,130,246,.15);margin:0 1px}
.panel-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:999;display:none;backdrop-filter:blur(4px)}
.panel-overlay.open{display:block}
.panel{position:fixed;top:0;right:0;width:56%;max-width:820px;height:100vh;background:var(--bg);border-left:1px solid var(--border);overflow-y:auto;transform:translateX(100%);transition:transform .3s cubic-bezier(.4,0,.2,1);z-index:1000}
.panel.open{transform:translateX(0)}
.panel-header{position:sticky;top:0;background:rgba(255,255,255,.94);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:16px 20px;z-index:10}
.panel-header-row{display:flex;justify-content:space-between;align-items:center}
.panel-header h2{font-size:16px;font-weight:700;letter-spacing:-.2px}
.panel-close{background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-muted);width:28px;height:28px;border-radius:var(--radius-sm);cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.panel-close:hover{background:var(--bg-hover);color:var(--text);border-color:var(--border-hover)}
.panel-meta{font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;gap:10px}
.panel-meta span{display:flex;align-items:center;gap:3px}
.panel-body{padding:16px 20px 24px}
.panel-tabs{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:16px}
.panel-tab{padding:8px 14px;font-size:11px;font-weight:600;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;transition:all .15s;text-transform:uppercase;letter-spacing:.4px}
.panel-tab:hover{color:var(--text-secondary)}
.panel-tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.panel-tab-content{display:none}.panel-tab-content.active{display:block}
.waterfall{font-size:0}
.wf-ruler{display:flex;justify-content:space-between;margin:0 0 6px 180px;padding-right:60px}
.wf-tick{font-size:9px;color:var(--text-muted);font-family:var(--mono);font-weight:500}
.wf-row{display:flex;align-items:center;height:30px;border-radius:var(--radius-sm);cursor:pointer;transition:background .1s;padding:0 0 0 4px}
.wf-row:hover{background:var(--bg-hover)}
.wf-row.selected{background:var(--bg-active)}
.wf-label{display:flex;align-items:center;gap:6px;width:176px;min-width:176px;padding-right:8px}
.wf-dot{width:7px;height:7px;border-radius:3px;flex-shrink:0}
.wf-name{font-size:11px;font-weight:500;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--sans)}
.wf-track{flex:1;height:20px;position:relative;background:var(--bg-card);border-radius:4px;overflow:visible}
.wf-bar{height:100%;border-radius:4px;min-width:3px;position:absolute;top:0;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:opacity .15s}
.wf-bar-label{font-size:8px;font-weight:600;color:rgba(255,255,255,.9);font-family:var(--mono);white-space:nowrap;padding:0 4px}
.wf-dur{font-size:10px;color:var(--text-muted);width:60px;min-width:60px;text-align:right;font-family:var(--mono);font-weight:500;padding-left:6px}
.graph-container{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);overflow:auto;padding:20px;min-height:240px}
.graph-container svg{display:block;margin:0 auto}
.gnode{cursor:pointer}
.gnode rect{transition:all .15s}
.gnode:hover rect{filter:brightness(1.2)}
.gnode.selected rect{stroke-width:2.5;filter:brightness(1.1)}
.gnode text{font-family:var(--sans);font-size:11px;font-weight:600;fill:var(--text)}
.gnode .gdur{font-family:var(--mono);font-size:9px;font-weight:500;fill:var(--text-muted)}
.gedge{fill:none;stroke-width:1.5}
.detail-section{margin-bottom:16px}
.detail-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;display:flex;align-items:center;gap:6px}
.detail-table{width:100%;border-collapse:separate;border-spacing:0;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden}
.detail-table td{padding:6px 10px;font-size:11px;border-top:1px solid var(--border)}
.detail-table tr:first-child td{border-top:none}
.detail-table td:first-child{color:var(--text-muted);font-weight:500;width:140px;white-space:nowrap;background:var(--bg)}
.detail-table td:last-child{word-break:break-all;white-space:pre-wrap;font-family:var(--mono);color:var(--text-secondary);font-size:11px}
.code-block{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 12px;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-word;font-family:var(--mono);max-height:200px;overflow-y:auto;color:var(--text-secondary);margin-top:4px}
.io-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px}
.io-actions{display:flex;gap:6px}
.io-toggle{background:var(--bg-elevated);border:1px solid var(--border);color:var(--text-secondary);border-radius:var(--radius-sm);font-size:10px;font-weight:600;padding:2px 8px;cursor:pointer;transition:all .15s}
.io-toggle:disabled{opacity:.5;cursor:not-allowed}
.io-toggle:hover{border-color:var(--border-hover);color:var(--text)}
.io-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.io-label.input{color:var(--blue)}.io-label.output{color:var(--green)}
.json-tree{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;margin-top:4px;font-family:var(--mono);font-size:11px;line-height:1.5;color:var(--text-secondary);max-height:200px;overflow:auto}
.json-node{margin-left:12px}
.json-item{margin:2px 0}
.json-key{color:var(--text)}
.json-string{color:var(--green)}
.json-number{color:var(--blue)}
.json-bool{color:var(--amber)}
.json-null{color:var(--text-muted)}
.io-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:12px;margin-bottom:4px}
.io-label.input{color:var(--blue)}.io-label.output{color:var(--green)}
#loading{text-align:center;padding:60px;color:var(--text-muted)}
.empty-state{color:var(--text-muted);padding:48px 20px;text-align:center;font-size:12px}
.empty-state svg{margin-bottom:10px;opacity:.3}
</style>
</head>
<body>
<nav class="sidebar">
  <div class="sidebar-logo">Q</div>
  <div class="sidebar-nav">
    <button class="nav-btn active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span class="tooltip">Tracing</span></button>
  </div>
  <div class="sidebar-footer">
    <select id="lb" title="Lookback"><option value="1h">1h</option><option value="3h">3h</option><option value="6h" selected>6h</option><option value="12h">12h</option><option value="24h">24h</option></select>
    <select id="lm" title="Limit"><option value="20">20</option><option value="50" selected>50</option><option value="100">100</option></select>
    <button onclick="load()" title="Refresh">&#8635;</button>
  </div>
</nav>
<div class="content">
  <div class="page-header">
    <div class="page-title-row"><div class="page-title">Tracing</div><div class="live-badge">Live</div></div>
    <div class="page-subtitle">Agent execution traces &middot; OpenTelemetry</div>
  </div>
  <div class="tabs">
    <div class="tab active" id="ht-sess" onclick="switchMainTab('sess')">Conversations</div>
    <div class="tab" id="ht-traces" onclick="switchMainTab('traces')">Traces</div>
    <div class="tab" id="ht-spans" onclick="switchMainTab('spans')">Spans</div>
  </div>
  <div id="loading">Loading&hellip;</div>
  <div class="tab-content active" id="tab-sess"><div id="sess-stats" class="stats-grid" style="display:none"></div><div id="sess-tbl"></div></div>
  <div class="tab-content" id="tab-traces"><div class="breadcrumb" id="bc-traces"></div><div id="traces-tbl"></div></div>
  <div class="tab-content" id="tab-spans"><div class="breadcrumb" id="bc-spans"></div><div id="spans-tbl"></div></div>
</div>
<div id="overlay" class="panel-overlay" onclick="closePanel()"></div>
<div id="panel" class="panel"></div>
<script src="/dashboard/assets/app.js"></script>
</body>
</html>`;

// ─── Dashboard JS (external file avoids inline-script CSP in VS Code Simple Browser) ───
/* eslint-disable max-len */
const DASHBOARD_JS = `const API='/dashboard/api/traces';
let allT=[],convMap={},selSessId=null,selTraceId=null;
const KIND_COLORS={chain:'#6366f1',agent:'#8b5cf6',llm:'#f59e0b',retriever:'#10b981',tool:'#ec4899',sql:'#06b6d4'};
function gk(a){return(a?.['openinference.span.kind']||'chain').toLowerCase()}
function fmtDur(ms){if(ms<1)return'<1ms';if(ms<1000)return Math.round(ms)+'ms';if(ms<60000)return(ms/1000).toFixed(1)+'s';return Math.floor(ms/60000)+'m '+Math.round((ms%60000)/1000)+'s'}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function tryJson(t){try{return JSON.parse(t)}catch{return null}}
function jsonNode(v){
  if(v===null)return span('json-null','null');
  if(Array.isArray(v)){
    const details=document.createElement('details');details.open=true;
    const summary=document.createElement('summary');summary.textContent='Array('+v.length+')';details.appendChild(summary);
    const list=document.createElement('div');list.className='json-node';
    v.forEach((it,i)=>{const row=document.createElement('div');row.className='json-item';row.appendChild(span('json-key',String(i)));row.appendChild(document.createTextNode(': '));row.appendChild(jsonNode(it));list.appendChild(row)});
    details.appendChild(list);return details;
  }
  if(typeof v==='object'){
    const keys=Object.keys(v||{});
    const details=document.createElement('details');details.open=true;
    const summary=document.createElement('summary');summary.textContent='Object('+keys.length+')';details.appendChild(summary);
    const list=document.createElement('div');list.className='json-node';
    keys.forEach(k=>{const row=document.createElement('div');row.className='json-item';row.appendChild(span('json-key',k));row.appendChild(document.createTextNode(': '));row.appendChild(jsonNode(v[k]));list.appendChild(row)});
    details.appendChild(list);return details;
  }
  if(typeof v==='string')return span('json-string','"'+v+'"');
  if(typeof v==='number')return span('json-number',String(v));
  if(typeof v==='boolean')return span('json-bool',String(v));
  return span('json-null','null');
}
function span(cls,text){const s=document.createElement('span');s.className=cls;s.textContent=text;return s}
function setJsonMode(id,mode){const j=document.getElementById(id+'-json'),r=document.getElementById(id+'-raw');if(!j||!r)return;j.style.display=mode==='json'?'block':'none';r.style.display=mode==='raw'?'block':'none';}
function bindIoButtons(){document.querySelectorAll('.io-toggle[data-io]').forEach(btn=>{btn.addEventListener('click',()=>{const io=btn.getAttribute('data-io'),mode=btn.getAttribute('data-mode');if(!io||!mode)return;setJsonMode(io,mode)})})}
function renderJsonBlock(id,text){const j=document.getElementById(id+'-json'),btn=document.getElementById(id+'-btn-json');if(!j||!btn)return;const parsed=tryJson(text);if(parsed===null){btn.disabled=true;j.style.display='none';return;}j.innerHTML='';j.appendChild(jsonNode(parsed));}
function nodeLabel(s){const op=s.operationName,a=s.attributes||{};if(op==='agent.run')return a['agent.id']||op;if(op==='llm.call')return a['llm.model_name']||'LLM';if(op.startsWith('tool.'))return op.slice(5);if(op.startsWith('retrieval.'))return op.slice(10);if(op.startsWith('agent.'))return op.slice(6);return op}
async function load(){
  document.getElementById('loading').style.display='block';
  ['sess-tbl','traces-tbl','spans-tbl'].forEach(id=>{const e=document.getElementById(id);if(e)e.innerHTML=''});
  try{
    const r=await fetch(API+'?lookback='+document.getElementById('lb').value+'&limit='+document.getElementById('lm').value);
    if(!r.ok)throw new Error('Server '+r.status);
    const d=await r.json();if(d.error)throw new Error(d.error);
    allT=d.traces||[];groupSessions();
    document.getElementById('loading').style.display='none';
    renderSessions();
  }catch(e){document.getElementById('loading').innerHTML='<span style="color:var(--red)">'+esc(e.message)+'</span>'}
}
function groupSessions(){
  convMap={};
  allT.forEach((t,i)=>{const sid=t.conversationSlug||t.conversationId||('anon-'+i);if(!convMap[sid])convMap[sid]={id:sid,slug:t.conversationSlug,traces:[],tokens:0,firstTime:t.startTime,lastTime:t.startTime,firstMsg:'',lastMsg:''};const g=convMap[sid];g.traces.push(t);g.tokens+=t.tokens?.total||0;if(t.startTime<g.firstTime){g.firstTime=t.startTime;g.firstMsg=t.inputValue||''}if(t.startTime>g.lastTime){g.lastTime=t.startTime;g.lastMsg=t.inputValue||''}});
  Object.values(convMap).forEach(g=>{if(!g.firstMsg&&g.traces.length)g.firstMsg=g.traces[0].inputValue||''});
}
function renderSessions(){
  const ss=Object.values(convMap).sort((a,b)=>b.lastTime>a.lastTime?1:-1);
  const st=document.getElementById('sess-stats');
  if(ss.length){st.style.display='grid';const totT=allT.length,totS=allT.reduce((s,t)=>s+t.spanCount,0),totTk=allT.reduce((s,t)=>s+(t.tokens?.total||0),0),errs=allT.filter(t=>t.status==='error').length;st.innerHTML='<div class="stat-card"><div class="stat-value">'+ss.length+'</div><div class="stat-label">Conversations</div></div><div class="stat-card"><div class="stat-value">'+totT+'</div><div class="stat-label">Traces</div></div><div class="stat-card"><div class="stat-value">'+totS.toLocaleString()+'</div><div class="stat-label">Spans</div></div><div class="stat-card"><div class="stat-value">'+totTk.toLocaleString()+'</div><div class="stat-label">Tokens</div></div><div class="stat-card"><div class="stat-value">'+errs+'</div><div class="stat-label">Errors</div></div>'}else st.style.display='none';
  const c=document.getElementById('sess-tbl');
  if(!ss.length){c.innerHTML='<div class="empty-state"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><div>No traces yet. Send a chat message to see traces appear here.</div></div>';return}
  let h='<table class="data-table"><thead><tr><th>Project / Conversation</th><th>Traces</th><th>Tokens</th><th>Duration</th><th>First Message</th><th>Last Active</th></tr></thead><tbody>';
  ss.forEach(s=>{const dur=s.traces.length>1?fmtDur(new Date(s.lastTime)-new Date(s.firstTime)):'--';h+='<tr onclick="pickSession(&quot;'+s.id+'&quot;)">';h+='<td><strong style="color:var(--text)">'+(s.slug||s.id.slice(0,12))+'</strong></td>';h+='<td class="mono">'+s.traces.length+'</td>';h+='<td class="mono">'+s.tokens.toLocaleString()+'</td>';h+='<td class="mono">'+dur+'</td>';h+='<td style="max-width:240px;color:var(--text-secondary)">'+esc((s.firstMsg||'--').slice(0,60))+'</td>';h+='<td class="mono">'+new Date(s.lastTime).toLocaleString()+'</td></tr>'});
  c.innerHTML=h+'</tbody></table>';
}
function pickSession(sid){selSessId=sid;switchMainTab('traces');renderTraces()}
function renderTraces(){
  const sess=convMap[selSessId];
  document.getElementById('bc-traces').innerHTML=sess?'<a onclick="switchMainTab(&quot;sess&quot;)">Conversations</a><span class="sep">&#8250;</span><strong style="color:var(--text)">'+(sess.slug||selSessId?.slice(0,12))+'</strong><span class="sep">&middot;</span><span>'+sess.traces.length+' traces</span>':'';
  const c=document.getElementById('traces-tbl');if(!sess){c.innerHTML='<div class="empty-state">Select a conversation.</div>';return}
  const traces=[...sess.traces].sort((a,b)=>a.startTime>b.startTime?1:-1);
  let h='<table class="data-table"><thead><tr><th>#</th><th>Time</th><th>Input</th><th>Model</th><th>Spans</th><th>Duration</th><th>Tokens</th><th>Tools</th><th>Status</th></tr></thead><tbody>';
  traces.forEach((t,i)=>{const tools=(t.toolCalls||[]).map(n=>'<span class="badge badge-tool">'+n+'</span>').join('')||'--';const b=t.status==='error'?'<span class="badge badge-err">Error</span>':'<span class="badge badge-ok">OK</span>';h+='<tr onclick="pickTrace(&quot;'+t.traceId+'&quot;)">';h+='<td class="mono">'+(i+1)+'</td><td class="mono">'+new Date(t.startTime).toLocaleTimeString()+'</td><td style="max-width:200px;color:var(--text-secondary)">'+esc((t.inputValue||'--').slice(0,50))+'</td><td class="mono" style="color:var(--amber)">'+(t.model||'--')+'</td><td class="mono">'+t.spanCount+'</td><td class="mono">'+fmtDur(t.durationMs)+'</td><td class="mono">'+(t.tokens?.total||0)+'</td><td>'+tools+'</td><td>'+b+'</td></tr>'});
  c.innerHTML=h+'</tbody></table>';
}
async function pickTrace(tid){
  selTraceId=tid;switchMainTab('spans');
  const c=document.getElementById('spans-tbl');c.innerHTML='<div class="empty-state">Loading spans&hellip;</div>';
  const sess=convMap[selSessId],trace=allT.find(t=>t.traceId===tid);
  document.getElementById('bc-spans').innerHTML='<a onclick="switchMainTab(&quot;sess&quot;)">Conversations</a><span class="sep">&#8250;</span><a onclick="switchMainTab(&quot;traces&quot;)">'+(sess?.slug||selSessId?.slice(0,10)||'--')+'</a><span class="sep">&#8250;</span><strong style="color:var(--text)">'+(trace?.inputValue?.slice(0,30)||tid.slice(0,8))+'</strong>';
  try{const r=await fetch(API+'/'+tid);const d=await r.json();renderSpanTable(d)}catch{c.innerHTML='<div class="empty-state" style="color:var(--red)">Failed to load spans</div>'}
}
function renderSpanTable(d){
  const sp=d.spans||[],c=document.getElementById('spans-tbl');if(!sp.length){c.innerHTML='<div class="empty-state">No spans.</div>';return}
  let h='<table class="data-table"><thead><tr><th>#</th><th>Operation</th><th>Kind</th><th>Duration</th><th>Status</th></tr></thead><tbody>';
  sp.forEach((s,i)=>{const k=gk(s.attributes),color=KIND_COLORS[k]||'#6366f1';const b=s.status==='error'?'<span class="badge badge-err">Error</span>':'<span class="badge badge-ok">OK</span>';h+='<tr onclick="openPanel(&quot;'+d.traceId+'&quot;)">';h+='<td class="mono">'+(i+1)+'</td><td><span style="display:inline-flex;align-items:center;gap:6px"><span class="wf-dot" style="background:'+color+'"></span><strong>'+esc(s.operationName)+'</strong></span></td><td class="mono" style="color:'+color+'">'+k+'</td><td class="mono">'+fmtDur(s.durationMs)+'</td><td>'+b+'</td></tr>'});
  c.innerHTML=h+'</tbody></table>';window._panelData=d;
}
function switchMainTab(t){document.querySelectorAll('.tab').forEach(e=>e.classList.remove('active'));document.getElementById('ht-'+t).classList.add('active');document.querySelectorAll('.tab-content').forEach(e=>e.classList.remove('active'));document.getElementById('tab-'+t).classList.add('active')}
async function openPanel(tid){
  const p=document.getElementById('panel'),o=document.getElementById('overlay');
  p.innerHTML='<div style="padding:48px;text-align:center;color:var(--text-muted)">Loading&hellip;</div>';
  p.classList.add('open');o.classList.add('open');
  try{let d=window._panelData;if(!d||d.traceId!==tid){const r=await fetch(API+'/'+tid);d=await r.json()}renderPanel(d)}catch{p.innerHTML='<div style="padding:48px;color:var(--red)">Failed</div>'}
}
function closePanel(){document.getElementById('panel').classList.remove('open');document.getElementById('overlay').classList.remove('open')}
function switchPanelTab(t){document.querySelectorAll('.panel-tab').forEach(e=>e.classList.remove('active'));document.getElementById('pt-'+t).classList.add('active');document.querySelectorAll('.panel-tab-content').forEach(e=>e.classList.remove('active'));document.getElementById('ptc-'+t).classList.add('active')}
function buildTree(spans){
  const map={};spans.forEach((s,i)=>{map[s.spanId]={span:s,idx:i,children:[]}});
  const roots=[];
  spans.forEach(s=>{if(s.parentSpanId&&map[s.parentSpanId])map[s.parentSpanId].children.push(map[s.spanId]);else roots.push(map[s.spanId])});
  return{roots,map};
}
function renderPanel(d){
  const p=document.getElementById('panel'),sp=d.spans||[];
  const root=sp.find(s=>!s.parentSpanId)||sp[0];
  const agentName=(root?.attributes?.['agent.id'])||d.rootOperation||'Trace';
  const minUs=Math.min(...sp.map(s=>s.startTimeUs)),maxUs=Math.max(...sp.map(s=>s.startTimeUs+s.durationMs*1000));
  const totalMs=Math.max((maxUs-minUs)/1000,1);
  let h='<div class="panel-header"><div class="panel-header-row"><h2>'+esc(agentName)+'</h2><button class="panel-close" onclick="closePanel()">&#x2715;</button></div><div class="panel-meta"><span class="mono">'+d.traceId.slice(0,16)+'&hellip;</span><span>'+d.spanCount+' spans</span><span>'+fmtDur(totalMs)+'</span></div></div>';
  h+='<div class="panel-body">';
  h+='<div class="panel-tabs"><div class="panel-tab active" id="pt-timeline" onclick="switchPanelTab(&quot;timeline&quot;)">Timeline</div><div class="panel-tab" id="pt-graph" onclick="switchPanelTab(&quot;graph&quot;)">Execution Graph</div></div>';
  h+='<div class="panel-tab-content active" id="ptc-timeline"><div class="waterfall">';
  const ticks=6;h+='<div class="wf-ruler">';for(let i=0;i<=ticks;i++)h+='<span class="wf-tick">'+fmtDur(totalMs*i/ticks)+'</span>';h+='</div>';
  sp.forEach((s,i)=>{const k=gk(s.attributes),color=KIND_COLORS[k]||'#6366f1',oP=(s.startTimeUs-minUs)/1000/totalMs*100,wP=s.durationMs/totalMs*100;
    h+='<div class="wf-row" onclick="selectSpan('+i+')" id="wfr'+i+'"><div class="wf-label"><span class="wf-dot" style="background:'+color+'"></span><span class="wf-name">'+esc(nodeLabel(s))+'</span></div><div class="wf-track"><div class="wf-bar" style="left:'+oP+'%;width:'+Math.max(wP,.5)+'%;background:'+color+'">'+(wP>10?'<span class="wf-bar-label">'+fmtDur(s.durationMs)+'</span>':'')+'</div></div><div class="wf-dur">'+fmtDur(s.durationMs)+'</div></div>'});
  h+='</div><div id="spanDetail" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px"><div style="color:var(--text-muted);font-size:12px">Click a span above to see details.</div></div></div>';
  h+='<div class="panel-tab-content" id="ptc-graph">'+renderGraph(sp)+'</div>';
  h+='</div>';
  p.innerHTML=h;window._sp=sp;if(sp.length)selectSpan(0);
}
function selectSpan(i){
  const sp=window._sp||[],s=sp[i];if(!s)return;
  document.querySelectorAll('.wf-row').forEach((r,j)=>r.classList.toggle('selected',j===i));
  document.querySelectorAll('.gnode').forEach(n=>n.classList.remove('selected'));
  const gn=document.getElementById('gn'+i);if(gn)gn.classList.add('selected');
  const a=s.attributes||{},inp=a['input.value']||'',out=a['output.value']||'',k=gk(a),color=KIND_COLORS[k]||'#6366f1';
  let h='<div class="detail-section"><div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span class="wf-dot" style="width:10px;height:10px;background:'+color+'"></span><span style="font-size:15px;font-weight:700">'+esc(s.operationName)+'</span></div>';
  h+='<table class="detail-table"><tbody>';
  h+='<tr><td>Kind</td><td style="color:'+color+'">'+(a['openinference.span.kind']||k)+'</td></tr>';
  h+='<tr><td>Duration</td><td>'+fmtDur(s.durationMs)+'</td></tr>';
  h+='<tr><td>Status</td><td>'+(s.status==='error'?'<span style="color:var(--red)">Error</span>':'<span style="color:var(--green)">OK</span>')+'</td></tr>';
  h+='</tbody></table></div>';
  if(inp){const iid='io-in-'+i;h+='<div class="io-row"><div class="io-label input">Input</div><div class="io-actions"><button id="'+iid+'-btn-json" class="io-toggle" data-io="'+iid+'" data-mode="json">JSON</button><button class="io-toggle" data-io="'+iid+'" data-mode="raw">Raw</button></div></div><div id="'+iid+'-json" class="json-tree" style="display:none"></div><div id="'+iid+'-raw" class="code-block">'+esc(inp)+'</div>'}
  if(out){const oid='io-out-'+i;h+='<div class="io-row"><div class="io-label output">Output</div><div class="io-actions"><button id="'+oid+'-btn-json" class="io-toggle" data-io="'+oid+'" data-mode="json">JSON</button><button class="io-toggle" data-io="'+oid+'" data-mode="raw">Raw</button></div></div><div id="'+oid+'-json" class="json-tree" style="display:none"></div><div id="'+oid+'-raw" class="code-block">'+esc(out)+'</div>'}
  const fl=Object.entries(a).filter(([k])=>!['input.value','output.value','openinference.span.kind'].includes(k));
  if(fl.length){h+='<div class="detail-section"><div class="detail-title">Attributes</div><table class="detail-table"><tbody>';fl.forEach(([k,v])=>h+='<tr><td>'+esc(k)+'</td><td>'+esc(String(v))+'</td></tr>');h+='</tbody></table></div>'}
  if(s.events?.length){h+='<div class="detail-section"><div class="detail-title">Events</div><table class="detail-table"><tbody>';s.events.forEach(e=>h+='<tr><td>'+esc(e.name)+'</td><td class="mono">'+new Date(e.timestamp).toLocaleTimeString()+'</td></tr>');h+='</tbody></table></div>'}
  document.getElementById('spanDetail').innerHTML=h;
  bindIoButtons();
  if(inp){renderJsonBlock('io-in-'+i,inp)}
  if(out){renderJsonBlock('io-out-'+i,out)}
}
function renderGraph(spans){
  const{roots}=buildTree(spans);
  const nw=140,nh=48,gx=16,gy=56,px=20,py=20,maxCols=4;
  const positions={};
  function layoutNode(node,cx,cy){
    positions[node.span.spanId]={x:cx,y:cy,idx:node.idx};
    const kids=node.children;if(!kids.length)return{w:nw,h:nh};
    const rows=[];for(let i=0;i<kids.length;i+=maxCols)rows.push(kids.slice(i,i+maxCols));
    let ry=cy+nh+gy,maxW=nw,totalH=nh;
    rows.forEach(row=>{const rowW=row.length*(nw+gx)-gx;const rowStartX=cx+nw/2-rowW/2;let rowMaxH=nh;row.forEach((child,ci)=>{const childX=rowStartX+ci*(nw+gx);const result=layoutNode(child,childX,ry);if(result.h>rowMaxH)rowMaxH=result.h});maxW=Math.max(maxW,rowW);ry+=rowMaxH+gy;totalH+=rowMaxH+gy});
    return{w:maxW,h:totalH};
  }
  let rootX=px;roots.forEach(r=>{const result=layoutNode(r,rootX,py);rootX+=result.w+gx*3});
  let svgW=0,svgH=0;Object.values(positions).forEach(p=>{if(p.x+nw+px>svgW)svgW=p.x+nw+px;if(p.y+nh+py>svgH)svgH=p.y+nh+py});
  svgW=Math.max(svgW,300);svgH=Math.max(svgH,120);
  let svg='<div class="graph-container"><svg width="'+svgW+'" height="'+svgH+'" viewBox="0 0 '+svgW+' '+svgH+'">';
  svg+='<defs><marker id="arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto"><polygon points="0 0, 7 2.5, 0 5" fill="#aaaaaa"/></marker></defs>';
  function drawEdges(node){const pp=positions[node.span.spanId];if(!pp)return;node.children.forEach(child=>{const cp=positions[child.span.spanId];if(!cp)return;const x1=pp.x+nw/2,y1=pp.y+nh,x2=cp.x+nw/2,y2=cp.y;const midY=(y1+y2)/2;svg+='<path class="gedge" d="M'+x1+' '+y1+' C'+x1+' '+midY+' '+x2+' '+midY+' '+x2+' '+y2+'" stroke="#aaaaaa" marker-end="url(#arr)"/>';drawEdges(child)})}
  roots.forEach(drawEdges);
  spans.forEach((s,i)=>{const pos=positions[s.spanId];if(!pos)return;const k=gk(s.attributes),color=KIND_COLORS[k]||'#6366f1';const label=nodeLabel(s).slice(0,15);const isErr=s.status==='error';svg+='<g class="gnode" id="gn'+i+'" onclick="selectSpan('+i+')">';svg+='<rect x="'+pos.x+'" y="'+pos.y+'" width="'+nw+'" height="'+nh+'" rx="8" ry="8" fill="'+color+'14" stroke="'+color+'"'+(isErr?' stroke-dasharray="4"':'')+'/>';svg+='<text x="'+(pos.x+nw/2)+'" y="'+(pos.y+20)+'" text-anchor="middle" style="font-size:11px;font-weight:600;fill:var(--text)">'+esc(label)+'</text>';svg+='<text class="gdur" x="'+(pos.x+nw/2)+'" y="'+(pos.y+36)+'" text-anchor="middle" style="font-size:9px;fill:var(--text-muted)">'+fmtDur(s.durationMs)+'</text>';if(isErr)svg+='<circle cx="'+(pos.x+nw-8)+'" cy="'+(pos.y+8)+'" r="3" fill="var(--red)"/>';svg+='</g>'});
  svg+='</svg></div>';return svg;
}
function showLoadError(msg){const el=document.getElementById('loading');if(!el)return;el.innerHTML='<span style="color:var(--red)">'+esc(msg)+'</span>'}
window.addEventListener('error',e=>showLoadError(e.message||'Dashboard error'));
window.addEventListener('unhandledrejection',e=>showLoadError(e.reason?.message||'Unhandled error'));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closePanel()});
try{load()}catch(e){showLoadError(e.message||'Failed to load')}
`;
/* eslint-enable max-len */

// ─── Routes ───────────────────────────────────────────────────────────────────

type DashboardUseCases = {
  listTraces: ListTracesUseCase;
  getTrace: GetTraceUseCase;
};

export function createDashboardRoutes(useCases: DashboardUseCases) {
  const app = new Hono();

  // ─── Serve dashboard UI ────────────────────────────────────────────────────
  app.get('/', (c) => c.html(DASHBOARD_HTML));

  // ─── Serve dashboard JS (external file — avoids VS Code webview CSP issue) ─
  app.get('/assets/app.js', (c) => {
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    c.header('Cache-Control', 'no-cache');
    return c.body(DASHBOARD_JS);
  });

  // ─── List traces (dashboard API — no auth, read-only) ─────────────────────
  app.get('/api/traces', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? '50'), 500);
    const lookbackMs = parseLookback(c.req.query('lookback') ?? '6h');
    const since = new Date(Date.now() - lookbackMs);
    const apiKey = process.env['DASHBOARD_API_KEY'] ?? 'local-dev';

    try {
      const traces = await useCases.listTraces.execute({
        apiKey,
        filter: { limit: Math.max(limit, 500) },
      });
      const items = traces
        .filter((t) => t.startedAt >= since)
        .slice(0, limit)
        .map(toListItem);
      return c.json({ traces: items });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Internal error' }, 500);
    }
  });

  // ─── Get trace detail (dashboard API — no auth, read-only) ────────────────
  app.get('/api/traces/:traceId', async (c) => {
    const apiKey = process.env['DASHBOARD_API_KEY'] ?? 'local-dev';
    try {
      const trace = await useCases.getTrace.execute({
        traceId: c.req.param('traceId') as TraceId,
        apiKey,
      });
      return c.json(toSpanDetail(trace));
    } catch (e) {
      if (e instanceof TraceNotFoundError) return c.json({ error: 'Trace not found' }, 404);
      return c.json({ error: e instanceof Error ? e.message : 'Internal error' }, 500);
    }
  });

  return app;
}
