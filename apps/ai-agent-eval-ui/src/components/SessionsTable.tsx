import type { TraceListItem } from '../types';

export type SessionGroup = {
  id: string;
  slug?: string;
  traces: TraceListItem[];
  tokens: number;
  firstTime: string;
  lastTime: string;
  firstMsg: string;
  lastMsg: string;
};

type SessionsTableProps = {
  sessions: SessionGroup[];
  onSelect: (sessionId: string) => void;
};

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export default function SessionsTable({ sessions, onSelect }: SessionsTableProps) {
  if (sessions.length === 0) {
    return (
      <div className="empty-state">No traces yet. Send a chat message to see traces appear here.</div>
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Project / Conversation</th>
          <th>Traces</th>
          <th>Tokens</th>
          <th>Duration</th>
          <th>First Message</th>
          <th>Last Active</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => {
          const first = new Date(session.firstTime);
          const last = new Date(session.lastTime);
          const duration = session.traces.length > 1 ? formatDuration(last.getTime() - first.getTime()) : '--';
          return (
            <tr key={session.id} onClick={() => onSelect(session.id)}>
              <td>
                <strong style={{ color: 'var(--text)' }}>{session.slug || session.id.slice(0, 12)}</strong>
              </td>
              <td className="mono">{session.traces.length}</td>
              <td className="mono">{session.tokens.toLocaleString()}</td>
              <td className="mono">{duration}</td>
              <td style={{ maxWidth: 240, color: 'var(--text-secondary)' }}>{session.firstMsg.slice(0, 60)}</td>
              <td className="mono">{last.toLocaleString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
