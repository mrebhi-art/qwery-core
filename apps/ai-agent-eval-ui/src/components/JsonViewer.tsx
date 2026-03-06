import React, { useState } from 'react';
import type { ReactNode } from 'react';

type JsonViewerProps = {
  id: string;
  label: string;
  value: string;
  defaultMode?: 'raw' | 'json';
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function parseJson(input: string): JsonValue | null {
  try {
    return JSON.parse(input) as JsonValue;
  } catch {
    return null;
  }
}

function renderJson(value: JsonValue): ReactNode {
  if (value === null) return <span className="json-null">null</span>;
  if (Array.isArray(value)) {
    return (
      <details open>
        <summary>Array({value.length})</summary>
        <div className="json-node">
          {value.map((item, index) => (
            <div key={index} className="json-item">
              <span className="json-key">{index}</span>: {renderJson(item)}
            </div>
          ))}
        </div>
      </details>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return (
      <details open>
        <summary>Object({entries.length})</summary>
        <div className="json-node">
          {entries.map(([key, val]) => (
            <div key={key} className="json-item">
              <span className="json-key">{key}</span>: {renderJson(val as JsonValue)}
            </div>
          ))}
        </div>
      </details>
    );
  }
  if (typeof value === 'string') return <span className="json-string">"{value}"</span>;
  if (typeof value === 'number') return <span className="json-number">{value}</span>;
  if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>;
  return <span className="json-null">null</span>;
}

export default function JsonViewer({ id, label, value, defaultMode = 'raw' }: JsonViewerProps) {
  const parsed = parseJson(value);
  const showJsonDefault = defaultMode === 'json' && parsed !== null;
  const [mode, setMode] = useState<'raw' | 'json'>(showJsonDefault ? 'json' : 'raw');

  return (
    <div>
      <div className="io-row">
        <div className={`io-label ${label === 'Input' ? 'input' : 'output'}`}>{label}</div>
        <div className="io-actions">
          <button
            className="io-toggle"
            onClick={() => setMode('json')}
            disabled={parsed === null}
          >
            JSON
          </button>
          <button
            className="io-toggle"
            onClick={() => setMode('raw')}
          >
            Raw
          </button>
        </div>
      </div>
      <div id={`${id}-json`} className="json-tree" style={{ display: mode === 'json' ? 'block' : 'none' }}>
        {parsed ? renderJson(parsed) : null}
      </div>
      <div id={`${id}-raw`} className="code-block" style={{ display: mode === 'raw' ? 'block' : 'none' }}>
        {value}
      </div>
    </div>
  );
}
