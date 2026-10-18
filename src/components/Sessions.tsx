import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { $session, $sessions, renameSession, startSession, switchSession } from '../lib/store';

const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function Sessions() {
  const active = useStore($session);
  const sessions = useStore($sessions);
  const [starting, setStarting] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const solvedCount = (id: string) => Object.values(sessions.find((s) => s.id === id)?.items ?? {}).filter((e) => e.solved).length;

  return (
    <section className="sessions card">
      <header>
        <div>
          <h2>Sessions</h2>
          <p className="muted">
            Coming back after a break? Start a new session to work through the sheets fresh. Earlier sessions and all
            notes are kept.
          </p>
        </div>
        {!starting && (
          <button className="btn primary" onClick={() => setStarting(true)}>
            New session
          </button>
        )}
      </header>

      {starting && (
        <form
          className="new-session"
          onSubmit={(e) => {
            e.preventDefault();
            startSession(name);
            setName('');
            setStarting(false);
          }}
        >
          <p>
            Every problem starts <strong>unsolved</strong> in the new session. “{active?.name}” keeps its{' '}
            {active ? solvedCount(active.id) : 0} solved problems and you can switch back any time.
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Session ${sessions.length + 1}`}
            aria-label="Session name"
          />
          <button className="btn primary" type="submit">
            Start fresh
          </button>
          <button className="btn" type="button" onClick={() => setStarting(false)}>
            Cancel
          </button>
        </form>
      )}

      <ul>
        {[...sessions].reverse().map((s) => (
          <li key={s.id} className={s.id === active?.id ? 'current' : ''}>
            <div className="info">
              {editing === s.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    renameSession(s.id, draft);
                    setEditing(null);
                  }}
                >
                  <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setEditing(null)} aria-label="Rename session" />
                </form>
              ) : (
                <button className="name" title="Rename" onClick={() => (setEditing(s.id), setDraft(s.name))}>
                  {s.name}
                </button>
              )}
              <span className="muted">
                started {fmt(s.startedAt)} · {solvedCount(s.id)} solved
              </span>
            </div>
            {s.id === active?.id ? (
              <span className="chip easy">current</span>
            ) : (
              <button className="btn" onClick={() => switchSession(s.id)}>
                Switch to
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
