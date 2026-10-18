import { useStore } from '@nanostores/react';
import { $session } from '../lib/store';
import { url } from '../lib/data';

export default function SessionBadge() {
  const session = useStore($session);
  return (
    <div className="session-badge">
      <span className="muted">Session</span> <strong>{session?.name}</strong>
      <a href={url('/activity/')}>Manage</a>
      <style>{`.session-badge { display: flex; gap: 6px; align-items: baseline; font-size: 13px; margin-bottom: 10px; } .session-badge a { margin-left: auto; }`}</style>
    </div>
  );
}
