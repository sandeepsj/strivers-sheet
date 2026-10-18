import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { $auth, $sync, $syncError, signIn, signOut } from '../lib/store';

const SYNC_LABEL = {
  local: 'Saved in this browser only',
  saving: 'Saving to Drive…',
  saved: 'Saved to Google Drive',
  error: 'Drive sync failed',
} as const;

export default function AuthButton() {
  const auth = useStore($auth);
  const sync = useStore($sync);
  const error = useStore($syncError);
  const [open, setOpen] = useState(false);

  const dot = <span className={`sync-dot ${sync}`} title={sync === 'error' ? error : SYNC_LABEL[sync]} />;

  if (auth.status === 'connecting') return <span className="muted">Connecting…</span>;

  if (auth.status !== 'signed-in')
    return (
      <span className="auth">
        {dot}
        <button className="btn primary" onClick={signIn} title={error || undefined}>
          {auth.status === 'expired' ? 'Reconnect Drive' : 'Sign in with Google'}
        </button>
      </span>
    );

  const { user } = auth;
  return (
    <span className="auth">
      {dot}
      <button className="btn avatar-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : user.name[0]}
      </button>
      {open && (
        <div className="menu card" onMouseLeave={() => setOpen(false)}>
          <strong>{user.name}</strong>
          <div className="muted">{user.email}</div>
          <div className="muted small">{sync === 'error' ? error : SYNC_LABEL[sync]}</div>
          <button className="btn" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      )}
    </span>
  );
}
