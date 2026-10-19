/**
 * Timezone-aware date helpers.
 * All "today / this week / this month" logic is evaluated in the STORE's timezone
 * (NEXT_PUBLIC_STORE_TIMEZONE), not the server's, so a sale at 1 AM in Karachi
 * lands on the right business day even when the server runs in UTC.
 */
export const TZ = process.env.NEXT_PUBLIC_STORE_TIMEZONE || 'Asia/Karachi';

export type RangeSpec = string | { from: string; to: string };

export interface ResolvedRange {
  key: string;
  label: string;
  /** inclusive start instant */
  start: Date;
  /** exclusive end instant */
  end: Date;
  /** first local day, YYYY-MM-DD */
  fromDate: string;
  /** last local day (inclusive), YYYY-MM-DD */
  toDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

function zonedParts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

/** YYYY-MM-DD of an instant in the given timezone. */
export function localDateStr(date: Date, tz: string = TZ): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Hour of day (0-23) of an instant in the given timezone. */
export function localHour(date: Date, tz: string = TZ): number {
  return zonedParts(date, tz).hour % 24;
}

/** The UTC instant at which the given local calendar day starts. */
export function zonedMidnight(dateStr: string, tz: string = TZ): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const p = zonedParts(new Date(guess), tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return new Date(guess - (asUTC - guess));
}

/** Add n days to a YYYY-MM-DD string (pure calendar arithmetic). */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Monday of the week containing the date (weeks start on Monday). */
export function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function build(key: string, label: string, from: string, toIncl: string, tz: string): ResolvedRange {
  return {
    key,
    label,
    start: zonedMidnight(from, tz),
    end: zonedMidnight(addDays(toIncl, 1), tz),
    fromDate: from,
    toDate: toIncl,
  };
}

/** Turn a preset name ("this_month"), a date ("2026-10-01"), a month ("2026-09") or {from,to} into a concrete range. */
export function resolveRange(
  spec: RangeSpec | undefined | null,
  now: Date = new Date(),
  tz: string = TZ
): ResolvedRange {
  const today = localDateStr(now, tz);
  const [ty, tm] = today.split('-').map(Number);

  if (spec && typeof spec === 'object') {
    let { from, to } = spec;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw new Error('Custom range needs from/to as YYYY-MM-DD');
    if (from > to) [from, to] = [to, from];
    return build('custom', from === to ? from : `${from} to ${to}`, from, to, tz);
  }

  const s = (spec ?? 'today').toString().trim().toLowerCase();
  if (DATE_RE.test(s)) return build('day', s, s, s, tz);
  if (MONTH_RE.test(s)) {
    const [y, m] = s.split('-').map(Number);
    return build('month', monthLabel(s), `${s}-01`, `${s}-${pad(lastDayOfMonth(y, m))}`, tz);
  }

  switch (s) {
    case 'today':
      return build(s, 'Today', today, today, tz);
    case 'yesterday': {
      const y = addDays(today, -1);
      return build(s, 'Yesterday', y, y, tz);
    }
    case 'this_week': {
      const mon = mondayOf(today);
      return build(s, 'This week', mon, addDays(mon, 6), tz);
    }
    case 'last_week': {
      const mon = addDays(mondayOf(today), -7);
      return build(s, 'Last week', mon, addDays(mon, 6), tz);
    }
    case 'this_month':
      return build(s, 'This month', `${ty}-${pad(tm)}-01`, `${ty}-${pad(tm)}-${pad(lastDayOfMonth(ty, tm))}`, tz);
    case 'last_month': {
      const py = tm === 1 ? ty - 1 : ty;
      const pm = tm === 1 ? 12 : tm - 1;
      return build(s, 'Last month', `${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(lastDayOfMonth(py, pm))}`, tz);
    }
    case 'this_year':
      return build(s, `Year ${ty}`, `${ty}-01-01`, `${ty}-12-31`, tz);
    case 'last_year':
      return build(s, `Year ${ty - 1}`, `${ty - 1}-01-01`, `${ty - 1}-12-31`, tz);
    case 'last_7_days':
      return build(s, 'Last 7 days', addDays(today, -6), today, tz);
    case 'last_30_days':
      return build(s, 'Last 30 days', addDays(today, -29), today, tz);
    case 'all_time':
      return build(s, 'All time', '2000-01-01', today, tz);
    default:
      throw new Error(`Unknown date range "${s}"`);
  }
}

export type Period = 'day' | 'week' | 'month' | 'year';

/** The day / week / month / year that contains `anchor` (YYYY-MM-DD). Used by the Reports page. */
export function rangeForPeriod(period: Period, anchor: string, tz: string = TZ): ResolvedRange {
  const [y, m] = anchor.split('-').map(Number);
  switch (period) {
    case 'day':
      return build('day', anchor, anchor, anchor, tz);
    case 'week': {
      const mon = mondayOf(anchor);
      return build('week', `Week of ${mon}`, mon, addDays(mon, 6), tz);
    }
    case 'month':
      return build('month', monthLabel(anchor.slice(0, 7)), `${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`, tz);
    case 'year':
      return build('year', `Year ${y}`, `${y}-01-01`, `${y}-12-31`, tz);
  }
}
