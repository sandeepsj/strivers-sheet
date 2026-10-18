import { useStore } from '@nanostores/react';
import { $auth, $notes, signIn } from '../lib/store';

export default function NotesList({ targets }: { targets: Record<string, { title: string; href: string; kind: string }> }) {
  const auth = useStore($auth);
  const notes = useStore($notes);
  if (auth.status !== 'signed-in')
    return (
      <p className="muted">
        Sign in to see the notes stored in your Drive.{' '}
        <button className="btn" onClick={signIn}>
          Sign in
        </button>
      </p>
    );
  const items = Object.entries(notes)
    .map(([key, file]) => ({ key, file, target: targets[key] }))
    .sort((a, b) => (b.file.modifiedTime ?? '').localeCompare(a.file.modifiedTime ?? ''));
  if (!items.length) return <p className="muted">No notes yet. Open any problem or topic and start writing.</p>;
  return (
    <div className="card">
      {items.map(({ key, file, target }) => (
        <div className="problem-row" key={key}>
          <span className="chip tag">{target?.kind ?? 'note'}</span>
          {target ? (
            <a className="title" href={target.href}>
              {target.title}
            </a>
          ) : (
            <span className="title muted">{key}</span>
          )}
          <span className="muted">{file.modifiedTime && new Date(file.modifiedTime).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
