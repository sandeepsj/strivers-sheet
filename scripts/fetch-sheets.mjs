// Downloads each Striver sheet from takeuforward.org and extracts the syllabus tree
// embedded in the Next.js RSC payload. Output: scripts/raw/<sheet>.json
import { mkdir, writeFile } from 'node:fs/promises';

import { SHEETS } from './sheet-list.mjs';

const OUT = new URL('./raw/', import.meta.url);

function rscPayload(html) {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let out = '';
  for (const m of html.matchAll(re)) out += JSON.parse(m[1]);
  return out;
}

// RSC dedupes repeated values as "$<lineId>:<path:segments>"; resolve those within the line.
function resolveRefs(root, lineId) {
  const prefix = `$${lineId}:`;
  const lookup = (path) => {
    let cur = root;
    for (const seg of path.split(':')) {
      if (seg === 'props' && Array.isArray(cur) && cur[0] === '$') cur = cur[3];
      else cur = cur?.[seg];
    }
    return cur;
  };
  const walk = (v) => {
    if (typeof v === 'string' && v.startsWith(prefix)) return walk(lookup(v.slice(prefix.length)));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(root);
}

function findKey(o, key) {
  if (!o || typeof o !== 'object') return undefined;
  if (key in o && !Array.isArray(o)) return o;
  for (const v of Object.values(o)) {
    const r = findKey(v, key);
    if (r) return r;
  }
}

function buildTree(syllabus) {
  const { fields, rows, roots } = syllabus;
  const node = (i) => {
    const r = rows[i];
    const o = Object.fromEntries(fields[r[0]].map((f, k) => [f, r[k + 1]]));
    const { status, notes, bookmark, bookmarkListIds, is_trial, ...rest } = o; // per-user fields
    if (Array.isArray(rest.children)) rest.children = rest.children.map(node);
    return rest;
  };
  return roots.map(node);
}

async function fetchSheet(slug) {
  const res = await fetch(`https://takeuforward.org/prep-hub/${slug}?page=sheet`, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  const payload = rscPayload(await res.text());
  const line = payload.split('\n').find((l) => l.includes('"sheet_syllabus"') && l.includes('"fields"'));
  if (!line) throw new Error(`${slug}: sheet_syllabus not found`);
  const idx = line.indexOf(':');
  const lineId = line.slice(0, idx);
  const data = resolveRefs(JSON.parse(line.slice(idx + 1)), lineId);
  const sheet = findKey(data, 'sheet_syllabus');
  const progress = findKey(data, 'progress')?.progress;
  const { id, name, description } = sheet.info;
  return { id, slug, name, description, total: progress?.total, tree: buildTree(sheet.sheet_syllabus) };
}

await mkdir(OUT, { recursive: true });
for (const { slug } of SHEETS) {
  const sheet = await fetchSheet(slug);
  await writeFile(new URL(`${slug}.json`, OUT), JSON.stringify(sheet, null, 1));
  console.log(`${slug}: ${sheet.name} (total ${sheet.total})`);
}
