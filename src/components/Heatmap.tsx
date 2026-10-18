import { useStore } from '@nanostores/react';
import { useMemo, useState } from 'react';
import { dayKey, solvesPerDay, streaks } from '../lib/activity';
import { $session, $sessions } from '../lib/store';

const WEEKS = 53;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);

export default function Heatmap({ compact = false }: { compact?: boolean }) {
  const session = useStore($session);
  const sessions = useStore($sessions);
  const [scope, setScope] = useState<'session' | 'all'>('session');

  const counts = useMemo(
    () => solvesPerDay(scope === 'all' ? sessions : session ? [session] : []),
    [scope, session, sessions],
  );

  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - start.getDay() - (WEEKS - 1) * 7); // Sunday, 52 weeks back
    const weeks: { key: string; date: Date; count: number; future: boolean }[][] = [];
    const monthLabels: { col: number; label: string }[] = [];
    const d = new Date(start);
    for (let w = 0; w < WEEKS; w++) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const key = dayKey(d);
        if (d.getDate() === 1 || (w === 0 && i === 0)) monthLabels.push({ col: w, label: MONTHS[d.getMonth()] });
        col.push({ key, date: new Date(d), count: counts.get(key) ?? 0, future: d > today });
        d.setDate(d.getDate() + 1);
      }
      weeks.push(col);
    }
    return { weeks, monthLabels: monthLabels.filter((m, i, a) => i === 0 || m.col - a[i - 1].col >= 3) };
  }, [counts]);

  const stats = useMemo(() => streaks(counts), [counts]);
  const inRange = weeks.flat().reduce((n, c) => n + c.count, 0);

  return (
    <section className="heatmap card">
      <header>
        <div>
          <h2>Activity</h2>
          <p className="muted">
            {inRange} solved in the last year
            {scope === 'session' && session ? ` · ${session.name}` : ' · all sessions'}
          </p>
        </div>
        {!compact && sessions.length > 1 && (
          <select value={scope} onChange={(e) => setScope(e.target.value as 'session' | 'all')} aria-label="Sessions shown">
            <option value="session">Current session</option>
            <option value="all">All sessions</option>
          </select>
        )}
      </header>
      <div className="hm-scroll">
        <div className="hm" style={{ gridTemplateColumns: `24px repeat(${WEEKS}, 12px)` }}>
          <span />
          {weeks.map((_, w) => (
            <span key={w} className="hm-month">
              {monthLabels.find((m) => m.col === w)?.label ?? ''}
            </span>
          ))}
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <Row key={row} row={row} weeks={weeks} />
          ))}
        </div>
      </div>
      <footer>
        <span>
          <strong>{stats.current}</strong> day streak · longest <strong>{stats.longest}</strong> ·{' '}
          <strong>{stats.activeDays}</strong> active days
        </span>
        <span className="hm-legend">
          Less {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`hm-cell l${l}`} />)} More
        </span>
      </footer>
    </section>
  );
}

function Row({ row, weeks }: { row: number; weeks: { key: string; date: Date; count: number; future: boolean }[][] }) {
  return (
    <>
      <span className="hm-day">{row % 2 ? ['', 'Mon', '', 'Wed', '', 'Fri', ''][row] : ''}</span>
      {weeks.map((col) => {
        const c = col[row];
        if (c.future) return <span key={c.key} />;
        const label = `${c.count || 'No'} problem${c.count === 1 ? '' : 's'} on ${c.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;
        return <i key={c.key} className={`hm-cell l${level(c.count)}`} title={label} aria-label={label} />;
      })}
    </>
  );
}
