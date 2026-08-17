/**
 * Calendar dates are plain `YYYY-MM-DD` strings and are deliberately *not*
 * timestamps: a transaction happens on a day, not at an instant. Keeping them
 * as strings means no timezone can shift a transaction into the wrong month.
 *
 * Audit fields (`createdAt`, `updatedAt`) are the opposite — real instants,
 * serialised as ISO-8601 UTC (`2025-06-14T18:22:05.114Z`).
 *
 * All arithmetic below goes through `Date.UTC`, so the machine's local timezone
 * never affects the result.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_MS = 86_400_000;

const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` -> UTC Date, or null when the date is malformed or unreal (2025-02-30). */
function toUTC(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const roundTrips = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  return roundTrips ? dt : null;
}

const fromUTC = (dt) =>
  `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;

export const isDate = (date) => toUTC(date) !== null;
export const isMonth = (month) => typeof month === 'string' && MONTH_RE.test(month) && Number(month.slice(5, 7)) >= 1 && Number(month.slice(5, 7)) <= 12;

/** Today according to the *server's local* clock — the API has no per-user timezone. */
export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const nowIso = () => new Date().toISOString();

/** ISO date strings sort lexicographically, which is the whole point of using them. */
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const minDate = (a, b) => (cmp(a, b) <= 0 ? a : b);
export const maxDate = (a, b) => (cmp(a, b) >= 0 ? a : b);
export const isBetween = (date, from, to) => cmp(date, from) >= 0 && cmp(date, to) <= 0;

export function addDays(date, days) {
  const dt = toUTC(date);
  return fromUTC(new Date(dt.getTime() + days * DAY_MS));
}

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Adds months and clamps the day to the target month's length, so
 * `addMonths('2025-01-31', 1)` is `2025-02-28` rather than March 3rd.
 */
export function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
}

/** Moves to a given day-of-month, clamped. Used to keep recurrence anchored to e.g. the 31st. */
export function withDay(date, day) {
  const [y, m] = date.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

export const dayOfMonth = (date) => Number(date.slice(8, 10));
export const monthKey = (date) => date.slice(0, 7);
export const startOfMonth = (date) => `${monthKey(date)}-01`;

export function endOfMonth(date) {
  const [y, m] = date.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}

/** `YYYY-MM` -> first / last calendar day of that month. */
export const monthStart = (month) => `${month}-01`;
export const monthEnd = (month) => endOfMonth(`${month}-01`);

/** Monday-based week start, matching ISO-8601 week numbering. */
export function startOfWeek(date) {
  const dt = toUTC(date);
  const shift = (dt.getUTCDay() + 6) % 7;
  return addDays(date, -shift);
}

export function diffDays(from, to) {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / DAY_MS);
}

/**
 * Splits an inclusive range into buckets for reports and projections. The first
 * and last buckets are clipped to the requested range so callers never see a
 * partial month's data attributed to days outside what they asked for.
 *
 *   buckets('2025-01-15', '2025-03-02', 'month')
 *   // [ { key: '2025-01', start: '2025-01-15', end: '2025-01-31' }, ... ]
 */
export function buckets(from, to, granularity = 'month') {
  if (cmp(from, to) > 0) return [];
  const out = [];
  let cursor = from;

  while (cmp(cursor, to) <= 0) {
    let key;
    let end;

    if (granularity === 'day') {
      key = cursor;
      end = cursor;
    } else if (granularity === 'week') {
      const weekStart = startOfWeek(cursor);
      key = weekStart;
      end = addDays(weekStart, 6);
    } else if (granularity === 'year') {
      key = cursor.slice(0, 4);
      end = `${key}-12-31`;
    } else {
      key = monthKey(cursor);
      end = endOfMonth(cursor);
    }

    out.push({ key, start: cursor, end: minDate(end, to) });
    cursor = addDays(end, 1);
  }

  return out;
}
