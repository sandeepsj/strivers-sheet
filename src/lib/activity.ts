import type { Session } from './store';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day, e.g. 2026-10-19. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Problems marked solved per local day (only those still solved). */
export function solvesPerDay(sessions: Session[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of sessions)
    for (const e of Object.values(s.items))
      if (e.solved && e.solvedAt) {
        const k = dayKey(new Date(e.solvedAt));
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
  return counts;
}

export function streaks(counts: Map<string, number>, today = new Date()) {
  const days = [...counts.keys()].sort();
  let longest = 0;
  let run = 0;
  let prev: Date | undefined;
  for (const k of days) {
    const d = new Date(`${k}T00:00:00`);
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  // current streak may end today or yesterday (today not started yet)
  let current = 0;
  const d = new Date(today);
  if (!counts.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (counts.has(dayKey(d))) {
    current++;
    d.setDate(d.getDate() - 1);
  }
  return { current, longest, activeDays: days.length };
}
