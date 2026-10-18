// Client state: progress (solved / revisit per problem), auth, sync status and the notes index.
// Progress is keyed by problem id, so a problem solved in one sheet is solved in every sheet.
import { atom, computed } from 'nanostores';
import { Drive, DriveError, NOTES_FOLDER, PROGRESS_FILE, ROOT_FOLDER, type DriveFile } from './drive';
import { fetchUser, hadSession, requestToken, revoke, storedAuth } from './google';

export interface Entry {
  solved: boolean;
  revisit?: boolean;
  /** last change, ms epoch; merges keep the newest entry per problem */
  at: number;
}
export type Progress = Record<string, Entry>;

interface ProgressFile {
  version: 1;
  updatedAt: string;
  items: Progress;
}

export type AuthState =
  | { status: 'signed-out' }
  | { status: 'connecting' }
  | { status: 'expired' }
  | { status: 'signed-in'; user: { name: string; email: string; picture?: string } };

export type SyncState = 'local' | 'saving' | 'saved' | 'error';

const PROGRESS_KEY = 'ss:progress';
const SAVE_DELAY = 1500;

export const $progress = atom<Progress>({});
export const $auth = atom<AuthState>({ status: 'signed-out' });
export const $sync = atom<SyncState>('local');
export const $syncError = atom<string>('');
/** note key -> Drive file, for notes that exist */
export const $notes = atom<Record<string, DriveFile>>({});

export const $solved = computed($progress, (p) => new Set(Object.keys(p).filter((id) => p[id].solved)));

let drive: Drive | undefined;
let token = '';
let folders: { root: string; notes: string } | undefined;
let progressFileId: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

// ---------- local cache ----------

function readLocal(): Progress {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writeLocal(p: Progress) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress still lives in memory and Drive */
  }
}

export function merge(a: Progress, b: Progress): Progress {
  const out: Progress = { ...a };
  for (const [id, e] of Object.entries(b)) if (!out[id] || e.at > out[id].at) out[id] = e;
  return out;
}

const sameProgress = (a: Progress, b: Progress) => JSON.stringify(a) === JSON.stringify(merge(a, b));

// ---------- progress mutations ----------

function setEntry(id: string, patch: Partial<Omit<Entry, 'at'>>) {
  const prev = $progress.get()[id] ?? { solved: false };
  const next = { ...$progress.get(), [id]: { ...prev, ...patch, at: Date.now() } };
  $progress.set(next);
  writeLocal(next);
  scheduleSave();
}

export const setSolved = (id: string, solved: boolean) => setEntry(id, { solved });
export const toggleSolved = (id: string) => setSolved(id, !$progress.get()[id]?.solved);
export const setRevisit = (id: string, revisit: boolean) => setEntry(id, { revisit });

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

async function readRemoteProgress(): Promise<Progress> {
  if (!drive || !folders) return {};
  if (!progressFileId) progressFileId = (await drive.findChild(folders.root, PROGRESS_FILE))?.id;
  if (!progressFileId) return {};
  try {
    return (JSON.parse(await drive.readText(progressFileId)) as ProgressFile).items ?? {};
  } catch (e) {
    if (e instanceof SyntaxError) return {};
    throw e;
  }
}

async function flush() {
  if (!drive || !folders) return;
  dirty = false;
  try {
    // re-read before writing so another device/tab's changes are merged, not overwritten
    const merged = merge(await readRemoteProgress(), $progress.get());
    const file: ProgressFile = { version: 1, updatedAt: new Date().toISOString(), items: merged };
    const body = JSON.stringify(file, null, 1);
    if (progressFileId) await drive.update(progressFileId, body, 'application/json');
    else progressFileId = (await drive.create(folders.root, PROGRESS_FILE, body, 'application/json')).id;
    $progress.set(merged);
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

    const [remote, noteFiles] = await Promise.all([readRemoteProgress(), d.listChildren(notes)]);
    $notes.set(Object.fromEntries(noteFiles.map((f) => [f.name.replace(/\.md$/, ''), f])));
    const local = $progress.get();
    const merged = merge(remote, local);
    $progress.set(merged);
    writeLocal(merged);
    $auth.set({ status: 'signed-in', user });
    if (!sameProgress(remote, local) || dirty) scheduleSave();
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
  $progress.set({});
  $sync.set('local');
  try {
    localStorage.removeItem(PROGRESS_KEY);
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
  $progress.set(readLocal());
  window.addEventListener('storage', (e) => {
    if (e.key === PROGRESS_KEY) $progress.set(merge($progress.get(), readLocal()));
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
