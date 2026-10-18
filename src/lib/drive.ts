// Minimal Google Drive v3 client over fetch. Uses the drive.file scope, so it only
// ever sees the folder and files this app created in the user's Drive.
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export const ROOT_FOLDER = 'Strivers Sheet';
export const NOTES_FOLDER = 'notes';
export const PROGRESS_FILE = 'progress.json';

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

export class DriveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class Drive {
  constructor(private token: string) {}

  private async req(input: string, init: RequestInit = {}) {
    const res = await fetch(input, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
    });
    if (!res.ok) throw new DriveError(res.status, `${init.method ?? 'GET'} ${input}: ${res.status} ${await res.text()}`);
    return res;
  }

  async list(q: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        q: `${q} and trashed = false`,
        fields: 'nextPageToken, files(id, name, modifiedTime)',
        pageSize: '1000',
        spaces: 'drive',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const body = await (await this.req(`${API}?${params}`)).json();
      files.push(...body.files);
      pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return files;
  }

  async listChildren(folderId: string) {
    return this.list(`'${folderId}' in parents`);
  }

  async findChild(parentId: string, name: string, folder = false): Promise<DriveFile | undefined> {
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const mime = folder ? ` and mimeType = '${FOLDER_MIME}'` : '';
    return (await this.list(`'${parentId}' in parents and name = '${escaped}'${mime}`))[0];
  }

  async ensureFolder(name: string, parentId = 'root'): Promise<string> {
    const found = await this.findChild(parentId, name, true);
    if (found) return found.id;
    const res = await this.req(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return (await res.json()).id;
  }

  async readText(fileId: string): Promise<string> {
    return (await this.req(`${API}/${fileId}?alt=media`)).text();
  }

  async create(parentId: string, name: string, content: string, mimeType: string): Promise<DriveFile> {
    const boundary = 'strivers' + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, parents: [parentId], mimeType }) +
      `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await this.req(`${UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return res.json();
  }

  async update(fileId: string, content: string, mimeType: string): Promise<DriveFile> {
    const res = await this.req(`${UPLOAD}/${fileId}?uploadType=media&fields=id,name,modifiedTime`, {
      method: 'PATCH',
      headers: { 'Content-Type': mimeType },
      body: content,
    });
    return res.json();
  }

  async remove(fileId: string) {
    await this.req(`${API}/${fileId}`, { method: 'DELETE' });
  }
}
