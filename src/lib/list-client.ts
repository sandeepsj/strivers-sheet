// Wires the statically rendered problem rows (ProblemRow.astro) to the store:
// checkbox state, solved/revisit/note markers, per-block counters and the filter bar.
import { $notes, $progress, setSolved } from './store';
import { noteKey } from './data';

export function enhanceLists() {
  const rows = [...document.querySelectorAll<HTMLElement>('.problem-row[data-id]')];
  const byId = new Map<string, HTMLElement[]>();
  for (const row of rows) {
    const id = row.dataset.id!;
    byId.set(id, [...(byId.get(id) ?? []), row]);
    row.querySelector<HTMLInputElement>('input.solved')!.addEventListener('change', (e) => {
      setSolved(id, (e.target as HTMLInputElement).checked);
    });
  }

  const counters = [...document.querySelectorAll<HTMLElement>('[data-count-for]')];
  const render = () => {
    const progress = $progress.get();
    const notes = $notes.get();
    for (const [id, els] of byId) {
      const e = progress[id];
      for (const row of els) {
        row.querySelector<HTMLInputElement>('input.solved')!.checked = !!e?.solved;
        row.classList.toggle('is-solved', !!e?.solved);
        row.classList.toggle('is-revisit', !!e?.revisit);
        row.classList.toggle('has-note', !!notes[noteKey.problem(id)]);
      }
    }
    for (const c of counters) {
      const scope = document.getElementById(c.dataset.countFor!);
      if (!scope) continue;
      const ids = new Set([...scope.querySelectorAll<HTMLElement>('.problem-row[data-id]')].map((r) => r.dataset.id!));
      const done = [...ids].filter((id) => progress[id]?.solved).length;
      c.textContent = `${done}/${ids.size}`;
      c.classList.toggle('complete', done === ids.size && ids.size > 0);
    }
    applyFilter();
  };

  const form = document.querySelector<HTMLFormElement>('#filters');
  function applyFilter() {
    if (!form) return;
    const q = (form.elements.namedItem('q') as HTMLInputElement).value.trim().toLowerCase();
    const diff = (form.elements.namedItem('diff') as HTMLSelectElement).value;
    const status = (form.elements.namedItem('status') as HTMLSelectElement).value;
    const progress = $progress.get();
    const active = !!(q || diff || status);
    for (const row of rows) {
      const e = progress[row.dataset.id!];
      const show =
        (!q || row.dataset.title!.includes(q)) &&
        (!diff || row.dataset.diff === diff) &&
        (!status ||
          (status === 'solved' && e?.solved) ||
          (status === 'unsolved' && !e?.solved) ||
          (status === 'revisit' && e?.revisit));
      row.hidden = !show;
    }
    for (const block of document.querySelectorAll<HTMLElement>('[data-filter-block]')) {
      const any = block.querySelector('.problem-row[data-id]:not([hidden])');
      block.hidden = !any;
      if (block instanceof HTMLDetailsElement && active && any) block.open = true;
    }
  }
  form?.addEventListener('input', applyFilter);
  form?.addEventListener('submit', (e) => e.preventDefault());

  $progress.subscribe(render);
  $notes.subscribe(render);
}
