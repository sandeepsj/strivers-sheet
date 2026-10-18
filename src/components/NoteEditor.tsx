import { useStore } from '@nanostores/react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useRef, useState } from 'react';
import { $auth, $notes, loadNote, saveNote, signIn } from '../lib/store';

const AUTOSAVE_MS = 1200;
type Status = 'idle' | 'loading' | 'unsaved' | 'saving' | 'saved' | 'error';

export default function NoteEditor({ noteKey, heading = 'Notes' }: { noteKey: string; heading?: string }) {
  const auth = useStore($auth);
  const exists = !!useStore($notes)[noteKey];
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [preview, setPreview] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(text);
  const signedIn = auth.status === 'signed-in';

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    setStatus('loading');
    loadNote(noteKey)
      .then((t) => {
        if (cancelled) return;
        setText(t);
        latest.current = t;
        setPreview(!!t.trim());
        setStatus('idle');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [signedIn, noteKey]);

  const persist = async () => {
    setStatus('saving');
    try {
      await saveNote(noteKey, latest.current);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const onChange = (value: string) => {
    setText(value);
    latest.current = value;
    setStatus('unsaved');
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, AUTOSAVE_MS);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const statusText = {
    idle: exists ? 'Stored in your Drive' : '',
    loading: 'Loading…',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved to Drive',
    error: 'Could not reach Drive',
  }[status];

  return (
    <section className="note card">
      <header>
        <h2>{heading}</h2>
        {signedIn && (
          <div className="tabs">
            <button className={`btn ${!preview ? 'active' : ''}`} onClick={() => setPreview(false)}>
              Write
            </button>
            <button className={`btn ${preview ? 'active' : ''}`} onClick={() => setPreview(true)}>
              Preview
            </button>
          </div>
        )}
      </header>
      {!signedIn ? (
        <p className="muted">
          Notes are saved as Markdown files in your Google Drive.{' '}
          <button className="btn" onClick={signIn}>
            {auth.status === 'expired' ? 'Reconnect Drive' : 'Sign in to write notes'}
          </button>
        </p>
      ) : preview ? (
        <div
          className="prose rendered"
          onDoubleClick={() => setPreview(false)}
          dangerouslySetInnerHTML={{
            __html: text.trim()
              ? DOMPurify.sanitize(marked.parse(text, { async: false }))
              : '<p class="muted">Nothing yet. Switch to Write to add a note.</p>',
          }}
        />
      ) : (
        <textarea
          className="textarea"
          value={text}
          disabled={status === 'loading'}
          placeholder="Approach, complexity, edge cases, mistakes to remember… (Markdown supported)"
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => status === 'unsaved' && (clearTimeout(timer.current), persist())}
        />
      )}
      {signedIn && <div className="muted status">{statusText}</div>}
      <style>{`
        .note { padding: 16px 18px; margin-top: 20px; }
        .note header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
        .note h2 { margin: 0; font-size: 18px; }
        .tabs { display: flex; gap: 6px; }
        .tabs .btn { padding: 4px 10px; font-size: 13px; }
        .tabs .btn.active { background: var(--surface-2); }
        .rendered { min-height: 60px; }
        .note .status { font-size: 12px; margin-top: 6px; min-height: 18px; }
      `}</style>
    </section>
  );
}
