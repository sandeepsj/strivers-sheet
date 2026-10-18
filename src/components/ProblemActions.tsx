import { useStore } from '@nanostores/react';
import { $progress, setRevisit, setSolved } from '../lib/store';

export default function ProblemActions({ id }: { id: string }) {
  const entry = useStore($progress)[id];
  const solved = !!entry?.solved;
  const revisit = !!entry?.revisit;
  return (
    <div className="actions">
      <label className="btn">
        <input type="checkbox" className="solved" checked={solved} onChange={(e) => setSolved(id, e.target.checked)} />
        {solved ? 'Solved' : 'Mark solved'}
      </label>
      <label className="btn">
        <input type="checkbox" checked={revisit} onChange={(e) => setRevisit(id, e.target.checked)} />
        Revisit later
      </label>
      {entry?.solved && entry.solvedAt && <span className="muted">solved {new Date(entry.solvedAt).toLocaleDateString()}</span>}
      <style>{`.actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }`}</style>
    </div>
  );
}
