// Client state: sessions of progress (solved / revisit per problem), auth, sync status and the notes index.
// Progress is keyed by problem id, so a problem solved in one sheet is solved in every sheet.
// A session is one run through the sheets; starting a new one begins with everything unsolved,
// while older sessions are kept (and can be switched back to). Notes are shared by all sessions.
import { atom, computed } from 'nanostores';
import { Drive, DriveError, NOTES_FOLDER, PROGRESS_FILE, ROOT_FOLDER, type DriveFile } from './drive';
import { fetchUser, hadSession, requestToken, revoke, storedAuth } from './google';

export interface Entry {
  solved: boolean;
  revisit?: boolean;
  /** when it was (last) marked solved, ms epoch; drives the activity heatmap */
  solvedAt?: number;
  /** last change, ms epoch; merges keep the newest entry per problem */
  at: number;
}
export type Progress = Record<string, Entry>;

export interface Session {
  id: string;
  name: string;
  startedAt: number;
  /** last change to name/startedAt */
  at: number;
  items: Progress;
}

export interface State {
  active: string;
  /** when `active` last changed */
  activeAt: number;
  sessions: Record<string, Session>;
}

interface ProgressFileV1 {
  version: 1;
  items: Progress;
}
interface ProgressFileV2 extends State {
  version: 2;
  updatedAt: string;
}

export type AuthState =
  | { status: 'signed-out' }
  | { status: 'connecting' }
  | { status: 'expired' }
  | { status: 'signed-in'; user: { name: string; email: string; picture?: string } };

export type SyncState = 'local' | 'saving' | 'saved' | 'error';

const STATE_KEY = 'ss:state';
const LEGACY_PROGRESS_KEY = 'ss:progress';
const SAVE_DELAY = 1500;
// Fixed id so two devices that start fresh don't each invent a different first session.
const FIRST_SESSION = 'default';

const firstSession = (items: Progress = {}): Session => ({
  id: FIRST_SESSION,
  name: 'Session 1',
  startedAt: Math.min(Date.now(), ...Object.values(items).map((e) => e.solvedAt ?? e.at)),
  at: 0,
  items,
});
const emptyState = (): State => ({ active: FIRST_SESSION, activeAt: 0, sessions: { [FIRST_SESSION]: firstSession() } });

export const $state = atom<State>(emptyState());
export const $auth = atom<AuthState>({ status: 'signed-out' });
export const $sync = atom<SyncState>('local');
export const $syncError = atom<string>('');
/** note key -> Drive file, for notes that exist */
export const $notes = atom<Record<string, DriveFile>>({});

export const $session = computed($state, (s) => s.sessions[s.active] ?? Object.values(s.sessions)[0]);
export const $progress = computed($session, (s) => s?.items ?? {});
export const $solved = computed($progress, (p) => new Set(Object.keys(p).filter((id) => p[id].solved)));
export const $sessions = computed($state, (s) => Object.values(s.sessions).sort((a, b) => a.startedAt - b.startedAt));

let drive: Drive | undefined;
let token = '';
let folders: { root: string; notes: string } | undefined;
let progressFileId: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

// ---------- (de)serialization ----------

/** Accepts the current file format, the v1 single-progress format, or garbage. */
function parseState(raw: unknown): State {
  const f = raw as Partial<ProgressFileV2> & Partial<ProgressFileV1>;
  if (f?.sessions && f.active) return { active: f.active, activeAt: f.activeAt ?? 0, sessions: f.sessions };
  if (f?.items) {
    // v1 had no solvedAt; its last-change time is the best guess for the heatmap
    const items = Object.fromEntries(
      Object.entries(f.items).map(([id, e]) => [id, e.solved && !e.solvedAt ? { ...e, solvedAt: e.at } : e]),
    );
    return { active: FIRST_SESSION, activeAt: 0, sessions: { [FIRST_SESSION]: firstSession(items) } };
  }
  return emptyState();
}

function readLocal(): State {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) return parseState(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_PROGRESS_KEY);
    if (legacy) return parseState({ items: JSON.parse(legacy) });
  } catch {
    /* fall through */
  }
  return emptyState();
}

function writeLocal(s: State) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ version: 2, ...s }));
    localStorage.removeItem(LEGACY_PROGRESS_KEY);
  } catch {
    /* storage unavailable: state still lives in memory and Drive */
  }
}

// ---------- merging ----------

export function mergeProgress(a: Progress, b: Progress): Progress {
  const out: Progress = { ...a };
  for (const [id, e] of Object.entries(b)) if (!out[id] || e.at > out[id].at) out[id] = e;
  return out;
}

export function merge(a: State, b: State): State {
  const sessions: Record<string, Session> = { ...a.sessions };
  for (const [id, s] of Object.entries(b.sessions)) {
    const o = sessions[id];
    if (!o) sessions[id] = s;
    else {
      const meta = s.at > o.at ? s : o;
      sessions[id] = { ...meta, items: mergeProgress(o.items, s.items) };
    }
  }
  const [active, activeAt] = b.activeAt > a.activeAt ? [b.active, b.activeAt] : [a.active, a.activeAt];
  return { active: sessions[active] ? active : FIRST_SESSION, activeAt, sessions };
}

const sameState = (a: State, b: State) => JSON.stringify(a) === JSON.stringify(merge(a, b));

// ---------- mutations ----------

function commit(next: State) {
  $state.set(next);
  writeLocal(next);
  scheduleSave();
}

function setEntry(id: string, patch: Partial<Omit<Entry, 'at'>>) {
  const s = $state.get();
  const session = $session.get();
  const prev = session.items[id] ?? { solved: false };
  const entry: Entry = { ...prev, ...patch, at: Date.now() };
  commit({ ...s, sessions: { ...s.sessions, [session.id]: { ...session, items: { ...session.items, [id]: entry } } } });
}

export function setSolved(id: string, solved: boolean) {
  const prev = $progress.get()[id];
  if (!!prev?.solved === solved) return;
  setEntry(id, { solved, solvedAt: solved ? Date.now() : undefined });
}
export const toggleSolved = (id: string) => setSolved(id, !$progress.get()[id]?.solved);
export const setRevisit = (id: string, revisit: boolean) => setEntry(id, { revisit });

/** Starts a fresh session (everything unsolved) and makes it active. */
export function startSession(name: string) {
  const s = $state.get();
  const now = Date.now();
  const id = `s-${now.toString(36)}`;
  const session: Session = { id, name: name.trim() || `Session ${Object.keys(s.sessions).length + 1}`, startedAt: now, at: now, items: {} };
  commit({ active: id, activeAt: now, sessions: { ...s.sessions, [id]: session } });
}

export function switchSession(id: string) {
  const s = $state.get();
  if (!s.sessions[id] || s.active === id) return;
  commit({ ...s, active: id, activeAt: Date.now() });
}

export function renameSession(id: string, name: string) {
  const s = $state.get();
  const session = s.sessions[id];
  if (!session || !name.trim()) return;
  commit({ ...s, sessions: { ...s.sessions, [id]: { ...session, name: name.trim(), at: Date.now() } } });
}

// ---------- Drive sync ----------

function scheduleSave() {
  dirty = true;
  if (!drive) {
    $sync.set('local');
    return;
  }
  $sync.set('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY);
}

async function readRemote(): Promise<State | undefined> {
  if (!drive || !folders) return undefined;
  if (!progressFileId) progressFileId = (await drive.findChild(folders.root, PROGRESS_FILE))?.id;
  if (!progressFileId) return undefined;
  try {
    return parseState(JSON.parse(await drive.readText(progressFileId)));
  } catch (e) {
    if (e instanceof SyntaxError) return undefined;
    throw e;
  }
}

async function flush() {
  if (!drive || !folders) return;
  dirty = false;
  try {
    // re-read before writing so another device/tab's changes are merged, not overwritten
    const remote = await readRemote();
    const merged = remote ? merge(remote, $state.get()) : $state.get();
    const file: ProgressFileV2 = { version: 2, updatedAt: new Date().toISOString(), ...merged };
    const body = JSON.stringify(file, null, 1);
    if (progressFileId) await drive.update(progressFileId, body, 'application/json');
    else progressFileId = (await drive.create(folders.root, PROGRESS_FILE, body, 'application/json')).id;
    $state.set(merged);
    writeLocal(merged);
    $sync.set(dirty ? 'saving' : 'saved');
  } catch (e) {
    dirty = true;
    handleDriveError(e);
  }
}

function handleDriveError(e: unknown) {
  console.error(e);
  if (e instanceof DriveError && e.status === 401) {
    drive = undefined;
    $auth.set({ status: 'expired' });
    $sync.set('local');
    return;
  }
  $sync.set('error');
  $syncError.set(e instanceof Error ? e.message : String(e));
}

async function connect(accessToken: string) {
  token = accessToken;
  $auth.set({ status: 'connecting' });
  try {
    const d = new Drive(accessToken);
    const [user, root] = await Promise.all([fetchUser(accessToken), d.ensureFolder(ROOT_FOLDER)]);
    const notes = await d.ensureFolder(NOTES_FOLDER, root);
    drive = d;
    folders = { root, notes };
    progressFileId = undefined;

    const [remote, noteFiles] = await Promise.all([readRemote(), d.listChildren(notes)]);
    $notes.set(Object.fromEntries(noteFiles.map((f) => [f.name.replace(/\.md$/, ''), f])));
    const local = $state.get();
    const merged = remote ? merge(remote, local) : local;
    $state.set(merged);
    writeLocal(merged);
    $auth.set({ status: 'signed-in', user });
    if (!remote || !sameState(remote, local) || dirty) scheduleSave();
    else $sync.set('saved');
  } catch (e) {
    drive = undefined;
    if (e instanceof DriveError && e.status === 401) $auth.set({ status: 'expired' });
    else {
      $auth.set({ status: 'signed-out' });
      $syncError.set(e instanceof Error ? e.message : String(e));
      $sync.set('error');
    }
  }
}

export async function signIn() {
  try {
    const auth = await requestToken();
    await connect(auth.token);
  } catch (e) {
    $syncError.set(e instanceof Error ? e.message : String(e));
    if ($auth.get().status !== 'expired') $auth.set({ status: 'signed-out' });
  }
}

export async function signOut() {
  clearTimeout(saveTimer);
  if (drive && dirty) await flush();
  await revoke(token);
  drive = undefined;
  folders = undefined;
  token = '';
  $auth.set({ status: 'signed-out' });
  $notes.set({});
  $state.set(emptyState());
  $sync.set('local');
  try {
    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem(LEGACY_PROGRESS_KEY);
  } catch {}
}

// ---------- notes ----------

export async function loadNote(key: string): Promise<string> {
  const file = $notes.get()[key];
  if (!drive || !file) return '';
  return drive.readText(file.id);
}

export async function saveNote(key: string, text: string) {
  if (!drive || !folders) throw new Error('Sign in to save notes');
  const notes = { ...$notes.get() };
  const file = notes[key];
  try {
    if (!text.trim()) {
      if (file) await drive.remove(file.id);
      delete notes[key];
    } else if (file) notes[key] = await drive.update(file.id, text, 'text/markdown');
    else notes[key] = await drive.create(folders.notes, `${key}.md`, text, 'text/markdown');
    $notes.set(notes);
  } catch (e) {
    handleDriveError(e);
    throw e;
  }
}

// ---------- boot ----------

let started = false;
export function init() {
  if (started || typeof window === 'undefined') return;
  started = true;
  $state.set(readLocal());
  window.addEventListener('storage', (e) => {
    if (e.key === STATE_KEY) $state.set(merge($state.get(), readLocal()));
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty && drive) {
      flush();
      e.preventDefault();
    }
  });
  const auth = storedAuth();
  if (auth) connect(auth.token);
  else if (hadSession()) $auth.set({ status: 'expired' });
}
