// Normalizes scripts/raw/*.json into the site's data files.
// A problem shared by several sheets becomes one entry in problems.json (keyed by TUF slug),
// so progress keyed by problem id is consistent across every sheet.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { SHEETS } from './sheet-list.mjs';

const RAW = new URL('./raw/', import.meta.url);
const OUT = new URL('../src/data/', import.meta.url);
const SUMMARIES = new URL('./summaries/', import.meta.url);

const DIFFICULTY = { basic: 'easy', core: 'medium', pro: 'hard' };
const TUF = 'https://takeuforward.org';

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const absolute = (u) => (u ? (u.startsWith('/') ? TUF + u : u) : undefined);
// Keep only plain problem links; TUF sometimes links discuss posts or text fragments.
const leetcode = (u) => {
  const slug = u?.match(/leetcode\.com\/problems\/([a-z0-9-]+)\/?(?:description\/?)?(?:[?#].*)?$/)?.[1];
  return slug ? `https://leetcode.com/problems/${slug}/` : undefined;
};

// Hand-written one-line summaries (paraphrased, not copied problem statements).
const summaries = {};
for (const f of (await readdir(SUMMARIES)).filter((f) => f.endsWith('.json')).sort()) {
  Object.assign(summaries, JSON.parse(await readFile(new URL(f, SUMMARIES), 'utf8')));
}
const problems = new Map();
const sheets = [];
const errors = [];

function addProblem(item, sheetId) {
  const id = item.slug;
  const existing = problems.get(id);
  if (existing) {
    if (existing.tufId !== item.id) errors.push(`slug ${id} has ids ${existing.tufId} and ${item.id}`);
    if (!existing.sheets.includes(sheetId)) existing.sheets.push(sheetId);
    // fill links that only some sheets carry
    existing.links.leetcode ??= leetcode(item.leetcode_link);
    existing.links.article ??= absolute(item.free_blog_link);
    existing.links.video ??= item.yt_video;
    return id;
  }
  problems.set(id, {
    id,
    tufId: item.id,
    title: item.label.trim(),
    kind: item.layoutType === 'learning' ? 'article' : 'problem',
    difficulty: DIFFICULTY[item.difficulty] ?? null,
    summary: summaries[id] ?? '',
    links: {
      leetcode: leetcode(item.leetcode_link),
      article: absolute(item.free_blog_link),
      video: item.yt_video || undefined,
    },
    topics: (item.topic_tags ?? []).map((t) => t.name),
    patterns: (item.pattern_tags ?? []).map((t) => t.name),
    sheets: [sheetId],
  });
  return id;
}

const isItem = (n) => n.type === 'item';
const collectItems = (n, sheetId) =>
  isItem(n) ? [addProblem(n, sheetId)] : (n.children ?? []).flatMap((c) => collectItems(c, sheetId));

for (const { id: sheetId, slug, short } of SHEETS) {
  const raw = JSON.parse(await readFile(new URL(`${slug}.json`, RAW), 'utf8'));
  const sections = [];
  for (const root of raw.tree) {
    if (root.type === 'contest') continue;
    const sectionId = slugify(root.slug || root.label);
    const groups = [];
    const loose = [];
    for (const child of root.children ?? []) {
      if (child.type === 'contest') continue;
      if (isItem(child)) loose.push(addProblem(child, sheetId));
      else groups.push({ id: slugify(child.slug || child.label), title: child.label.trim(), problemIds: collectItems(child, sheetId) });
    }
    if (loose.length) groups.unshift({ id: sectionId, title: '', problemIds: loose });
    sections.push({ id: sectionId, title: root.label.trim(), groups });
  }
  const count = sections.flatMap((s) => s.groups).reduce((n, g) => n + g.problemIds.length, 0);
  if (raw.total != null && count !== raw.total) errors.push(`${sheetId}: ${count} items, TUF says ${raw.total}`);
  sheets.push({ id: sheetId, slug, name: raw.name.trim(), short, description: raw.description, count, sections });
}

const list = [...problems.values()];
const missing = list.filter((p) => !p.summary).map((p) => p.id);
const unknown = Object.keys(summaries).filter((id) => !problems.has(id));
if (unknown.length) errors.push(`summaries for unknown ids: ${unknown.join(', ')}`);

await mkdir(OUT, { recursive: true });
await writeFile(new URL('problems.json', OUT), JSON.stringify(list, null, 1));
await writeFile(new URL('sheets.json', OUT), JSON.stringify(sheets, null, 1));

for (const s of sheets) console.log(`${s.id.padEnd(8)} ${String(s.count).padStart(4)} items  ${s.sections.length} sections  ${s.name}`);
console.log(`${list.length} unique problems, ${list.filter((p) => p.sheets.length > 1).length} shared by 2+ sheets, ${missing.length} without summary`);
if (missing.length) console.log('  missing:', missing.join(', '));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
