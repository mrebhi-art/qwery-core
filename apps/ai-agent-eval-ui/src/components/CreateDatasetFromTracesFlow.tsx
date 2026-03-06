import { useEffect, useState } from 'react';
import { fetchTrace } from '../api';
import { createDatasetFromTraces } from '../api';
import type { TraceListItem, Artifact, TraceDetail } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type TraceDraft = {
  traceId: string;
  inputPreview: string;
  toolCalls: string[];
  artifacts: Artifact[];
  goldenOutput: string;
  loading: boolean;
};

type Step = 1 | 2 | 3;

type Props = {
  selectedTraces: TraceListItem[];
  onClose: () => void;
  onCreated: (datasetId: string, datasetName: string) => void;
};

// ─── Artifact helpers ─────────────────────────────────────────────────────────

function extractArtifactsFromDetail(detail: TraceDetail): Artifact[] {
  const artifacts: Artifact[] = [];
  for (const span of detail.spans) {
    const raw = span.attributes?.['artifacts'];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Artifact[];
      if (Array.isArray(parsed)) artifacts.push(...parsed);
    } catch { /* skip */ }
  }
  return artifacts;
}

function artifactLabel(a: Artifact): string {
  if (a.type === 'chart') return `Chart SVG (${a.name})`;
  if (a.type === 'sql')   return `SQL (${a.name})`;
  if (a.type === 'table') return `Table (${a.name})`;
  return a.name;
}

// ─── Step 1 — Golden outputs per trace ───────────────────────────────────────

function TraceRow({
  draft,
  index,
  onGoldenChange,
}: {
  draft: TraceDraft;
  index: number;
  onGoldenChange: (traceId: string, value: string) => void;
}) {
  return (
    <div className="dtf-trace-row">
      <div className="dtf-trace-header">
        <span className="dtf-trace-num">#{index + 1}</span>
        <span className="dtf-trace-input">{draft.inputPreview.slice(0, 80) || '(no input)'}</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {draft.toolCalls.map((t) => (
            <span key={t} className="badge badge-tool">{t}</span>
          ))}
        </div>
      </div>

      {draft.loading ? (
        <div className="dtf-loading">Loading trace…</div>
      ) : (
        <>
          {draft.artifacts.length > 0 && (
            <div className="dtf-artifacts">
              <span className="dtf-artifacts-label">Use as golden:</span>
              {draft.artifacts.map((a, i) => (
                <button
                  key={i}
                  className="dtf-use-btn"
                  onClick={() => onGoldenChange(draft.traceId, a.data)}
                  title={`Fill golden output with ${a.name}`}
                >
                  {artifactLabel(a)}
                </button>
              ))}
            </div>
          )}
          <textarea
            className="dtf-golden-input"
            placeholder="Enter expected (golden) output for this trace…"
            value={draft.goldenOutput}
            onChange={(e) => onGoldenChange(draft.traceId, e.target.value)}
            rows={4}
          />
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CreateDatasetFromTracesFlow({ selectedTraces, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [drafts, setDrafts] = useState<TraceDraft[]>(() =>
    selectedTraces.map((t) => ({
      traceId: t.traceId,
      inputPreview: t.inputValue,
      toolCalls: t.toolCalls,
      artifacts: [],
      goldenOutput: '',
      loading: true,
    })),
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInfo, setCreatedInfo] = useState<{ id: string; name: string } | null>(null);

  // Fetch full trace details on mount to get artifacts
  useEffect(() => {
    selectedTraces.forEach((t) => {
      fetchTrace(t.traceId)
        .then((detail: TraceDetail) => {
          const artifacts = extractArtifactsFromDetail(detail);
          setDrafts((prev) =>
            prev.map((d) =>
              d.traceId === t.traceId ? { ...d, artifacts, loading: false } : d,
            ),
          );
        })
        .catch(() => {
          setDrafts((prev) =>
            prev.map((d) =>
              d.traceId === t.traceId ? { ...d, loading: false } : d,
            ),
          );
        });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoldenChange = (traceId: string, value: string) => {
    setDrafts((prev) =>
      prev.map((d) => (d.traceId === traceId ? { ...d, goldenOutput: value } : d)),
    );
  };

  const allGoldenFilled = drafts.every((d) => d.goldenOutput.trim().length > 0);
  const canCreate = name.trim().length > 0 && allGoldenFilled;

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createDatasetFromTraces(
        name.trim(),
        description.trim(),
        drafts.map((d) => ({
          traceId: d.traceId,
          goldenOutput: d.goldenOutput,
          metadata: { toolCalls: d.toolCalls.join(',') },
        })),
      );
      setCreatedInfo({ id: result.dataset.id, name: result.dataset.name });
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create dataset');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="eval-overlay">
      <div className="eval-modal dtf-modal">
        {/* Header */}
        <div className="eval-modal-header">
          <div>
            <div className="eval-modal-title">Create Dataset from Traces</div>
            <div className="eval-modal-subtitle">
              {step === 1 && `${selectedTraces.length} trace${selectedTraces.length > 1 ? 's' : ''} selected — set the expected output for each`}
              {step === 2 && 'Name your dataset'}
              {step === 3 && 'Dataset created'}
            </div>
          </div>
          <button className="eval-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Step indicators */}
        <div className="dtf-steps">
          {(['Golden Outputs', 'Dataset Info', 'Done'] as const).map((label, i) => (
            <div key={i} className={`dtf-step${step === i + 1 ? ' active' : step > i + 1 ? ' done' : ''}`}>
              <span className="dtf-step-dot">{step > i + 1 ? '✓' : i + 1}</span>
              <span className="dtf-step-label">{label}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Golden outputs */}
        {step === 1 && (
          <div className="dtf-body">
            <p className="dtf-hint">
              For each trace, review the detected artifacts and provide the <strong>expected correct output</strong>.
              Click an artifact button to pre-fill the field, or type manually.
            </p>
            <div className="dtf-traces-list">
              {drafts.map((draft, i) => (
                <TraceRow
                  key={draft.traceId}
                  draft={draft}
                  index={i}
                  onGoldenChange={handleGoldenChange}
                />
              ))}
            </div>
            <div className="dtf-footer">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                className="btn"
                disabled={!allGoldenFilled}
                onClick={() => setStep(2)}
                title={!allGoldenFilled ? 'All traces need a golden output' : undefined}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Name + confirm */}
        {step === 2 && (
          <div className="dtf-body">
            <div className="dtf-form">
              <div className="eval-field">
                <label>Dataset Name *</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Chart generation — Q1 2026"
                />
              </div>
              <div className="eval-field">
                <label>Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
              <div className="dtf-summary">
                <div className="dtf-summary-row">
                  <span>Examples</span>
                  <strong>{drafts.length}</strong>
                </div>
                <div className="dtf-summary-row">
                  <span>Traces with chart artifacts</span>
                  <strong>{drafts.filter((d) => d.artifacts.some((a) => a.type === 'chart')).length}</strong>
                </div>
                <div className="dtf-summary-row">
                  <span>Traces with SQL artifacts</span>
                  <strong>{drafts.filter((d) => d.artifacts.some((a) => a.type === 'sql')).length}</strong>
                </div>
              </div>
              {error && <div className="dtf-error">{error}</div>}
            </div>
            <div className="dtf-footer">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
              <button
                className="btn btn-primary"
                disabled={!canCreate || creating}
                onClick={handleCreate}
              >
                {creating ? 'Creating…' : 'Create Dataset'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 3 && createdInfo && (
          <div className="dtf-body dtf-done">
            <div className="dtf-done-icon">✓</div>
            <div className="dtf-done-title">Dataset created</div>
            <div className="dtf-done-name">{createdInfo.name}</div>
            <div className="dtf-done-detail">{drafts.length} examples added from traces.</div>
            <div className="dtf-done-detail" style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              {createdInfo.id}
            </div>
            <div className="dtf-footer" style={{ justifyContent: 'center', marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
              <button
                className="btn btn-primary"
                onClick={() => onCreated(createdInfo.id, createdInfo.name)}
              >
                Run Evaluation →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
