import { useStore } from '@nanostores/react';
import { $solved } from '../lib/store';

export default function Progress({ ids, label = 'solved' }: { ids: string[]; label?: string }) {
  const solved = useStore($solved);
  const done = ids.filter((id) => solved.has(id)).length;
  const pct = ids.length ? Math.round((done / ids.length) * 100) : 0;
  return (
    <div className="progress">
      <div className="progress-text">
        <span>
          <strong>{done}</strong> / {ids.length} {label}
        </span>
        <span className="muted">{pct}%</span>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <style>{`.progress-text { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }`}</style>
    </div>
  );
}
