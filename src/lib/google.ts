// Google Identity Services (token model): the browser gets a short-lived access token
// directly from Google, no backend involved.
declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.file';
const AUTH_KEY = 'ss:auth';

export const CLIENT_ID: string = import.meta.env.PUBLIC_GOOGLE_CLIENT_ID ?? '';

export interface StoredAuth {
  token: string;
  expiresAt: number;
}

let gisPromise: Promise<void> | undefined;
function loadGis() {
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

export function storedAuth(): StoredAuth | undefined {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') as StoredAuth | null;
    // treat tokens within a minute of expiry as expired
    return a && a.expiresAt - 60_000 > Date.now() ? a : undefined;
  } catch {
    return undefined;
  }
}

export const hadSession = () => {
  try {
    return localStorage.getItem(AUTH_KEY) !== null;
  } catch {
    return false;
  }
};

/** Opens Google's consent popup (must be called from a user gesture). */
export async function requestToken(): Promise<StoredAuth> {
  if (!CLIENT_ID) throw new Error('PUBLIC_GOOGLE_CLIENT_ID is not configured');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (r: any) => {
        if (r.error) return reject(new Error(r.error_description ?? r.error));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(r, 'https://www.googleapis.com/auth/drive.file'))
          return reject(new Error('Google Drive access is needed to save your progress.'));
        const auth = { token: r.access_token, expiresAt: Date.now() + Number(r.expires_in) * 1000 };
        localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
        resolve(auth);
      },
      error_callback: (e: any) => reject(new Error(e?.message ?? e?.type ?? 'Sign-in cancelled')),
    });
    client.requestAccessToken({ prompt: hadSession() ? '' : 'consent' });
  });
}

export async function revoke(token: string) {
  localStorage.removeItem(AUTH_KEY);
  try {
    await loadGis();
    window.google.accounts.oauth2.revoke(token, () => {});
  } catch {
    /* best effort */
  }
}

export async function fetchUser(token: string) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`userinfo ${res.status}`);
  const u = await res.json();
  return { name: u.name as string, email: u.email as string, picture: u.picture as string | undefined };
}
