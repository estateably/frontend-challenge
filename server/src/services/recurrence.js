import * as d from '../lib/dates.js';

const MONTH_STEPS = { monthly: 1, quarterly: 3, yearly: 12 };
const DAY_STEPS = { weekly: 7, biweekly: 14 };

/**
 * Expands a scheduled item into the concrete dates it falls on.
 *
 * Monthly-family frequencies stay anchored to the *original* day of month and
 * clamp per month, so a bill due on the 31st lands on Feb 28 and then back on
 * Mar 31 — it never drifts to the 28th permanently.
 */
export function occurrenceDates(item, from, to, { max = 2000 } = {}) {
  const end = item.endDate ? d.minDate(to, item.endDate) : to;
  if (d.cmp(from, end) > 0) return [];

  if (item.frequency === 'once') {
    return d.isBetween(item.startDate, from, end) ? [item.startDate] : [];
  }

  const dates = [];

  if (DAY_STEPS[item.frequency]) {
    const step = DAY_STEPS[item.frequency];
    let date = item.startDate;

    if (d.cmp(date, from) < 0) {
      const skip = Math.floor(d.diffDays(date, from) / step);
      date = d.addDays(date, skip * step);
      while (d.cmp(date, from) < 0) date = d.addDays(date, step);
    }

    while (d.cmp(date, end) <= 0 && dates.length < max) {
      dates.push(date);
      date = d.addDays(date, step);
    }

    return dates;
  }

  const step = MONTH_STEPS[item.frequency];
  const anchorDay = d.dayOfMonth(item.startDate);
  const base = d.startOfMonth(item.startDate);
  const at = (index) => d.withDay(d.addMonths(base, index * step), anchorDay);

  // Jump most of the way there before stepping, so a long history is cheap.
  const monthsApart =
    (Number(from.slice(0, 4)) - Number(base.slice(0, 4))) * 12 +
    (Number(from.slice(5, 7)) - Number(base.slice(5, 7)));
  let index = Math.max(0, Math.floor(monthsApart / step));
  while (index > 0 && d.cmp(at(index), from) >= 0) index -= 1;
  while (d.cmp(at(index), from) < 0) index += 1;

  while (d.cmp(at(index), end) <= 0 && dates.length < max) {
    dates.push(at(index));
    index += 1;
  }

  return dates;
}

/**
 * The same expansion, annotated with what actually happened to each occurrence.
 *
 *   posted    — a real transaction exists for it (auto-generated history, or
 *               materialised via POST /api/scheduled-items/:id/post)
 *   skipped   — explicitly dismissed for that date
 *   overdue   — due on or before today and neither posted nor skipped
 *   scheduled — still in the future
 */
export function occurrences(item, from, to, { transactionsByScheduledItem, asOf = d.today() } = {}) {
  const posted = new Map(
    (item.postedOccurrences ?? []).map((entry) => [entry.date, entry.transactionId]),
  );

  for (const transaction of transactionsByScheduledItem?.get(item.id) ?? []) {
    posted.set(transaction.date, transaction.id);
  }

  const skipped = new Set(item.skippedDates ?? []);

  return occurrenceDates(item, from, to).map((date) => {
    const transactionId = posted.get(date) ?? null;
    const status = transactionId
      ? 'posted'
      : skipped.has(date)
        ? 'skipped'
        : d.cmp(date, asOf) <= 0
          ? 'overdue'
          : 'scheduled';

    return {
      scheduledItemId: item.id,
      name: item.name,
      date,
      amount: item.amount,
      currency: item.currency,
      accountId: item.accountId,
      categoryId: item.categoryId,
      projectId: item.projectId,
      kind: item.kind,
      status,
      transactionId,
    };
  });
}

/** First occurrence on or after `from` that has not been posted or skipped. */
export function nextDueDate(item, from = d.today()) {
  if (item.status !== 'active') return null;
  const horizon = d.addMonths(from, 24);
  const posted = new Set((item.postedOccurrences ?? []).map((entry) => entry.date));
  const skipped = new Set(item.skippedDates ?? []);
  return (
    occurrenceDates(item, from, horizon).find((date) => !posted.has(date) && !skipped.has(date)) ??
    null
  );
}
