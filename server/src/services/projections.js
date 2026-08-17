import { list } from '../store/index.js';
import * as d from '../lib/dates.js';
import { accountsInScope, filterTransactions, transactionsByScheduledItem } from './query.js';
import { balanceSnapshot } from './balances.js';
import { occurrences } from './recurrence.js';

/**
 * User story 4: where the total balance is heading.
 *
 * The one rule that makes this coherent — and the thing worth arguing about:
 *
 *   dates up to and including `asOf`  -> ACTUAL transactions from the ledger
 *   dates after `asOf`               -> SCHEDULED occurrences not yet posted
 *
 * Without that split, a rent payment that has already cleared would be counted
 * once as a transaction and again as this month's scheduled bill. It does mean
 * the current bucket is a hybrid: part history, part forecast. Each bucket says
 * which it is via `isProjected`, and keeps `actual` and `scheduled` separate so
 * the client can render the seam however it likes.
 *
 * Excluded from the forecast, deliberately:
 *   - paused scheduled items
 *   - occurrences already posted or explicitly skipped
 *   - discretionary spending. This is a *commitments* forecast, not a behavioural
 *     model. `categoryBudgetBurn` bolts on a naive estimate when you ask for it,
 *     and the response labels it as an assumption rather than a fact.
 */
export function budgetProjection({
  from = d.today(),
  to,
  granularity = 'month',
  currency,
  accountIds,
  includeScheduled = true,
  includeCategoryBudgets = false,
  asOf = d.today(),
}) {
  const accounts = accountsInScope({ currency, accountIds });
  const ids = accounts.map((account) => account.id);

  // Opening position: everything that had settled the day before the window.
  const opening = balanceSnapshot(accounts, d.addDays(from, -1));
  const startingBalance = opening.totalsByCurrency[currency]?.available ?? 0;

  const actuals = filterTransactions({
    accountIds: ids,
    from,
    to,
    statuses: ['posted', 'pending'],
    includeTransfers: false,
  });

  const scheduledIndex = transactionsByScheduledItem();
  const scheduledItems = list('scheduledItems').filter(
    (item) => item.status === 'active' && ids.includes(item.accountId),
  );

  const forecastFrom = d.maxDate(from, d.addDays(asOf, 1));
  const forecast = includeScheduled
    ? scheduledItems
        .flatMap((item) =>
          occurrences(item, forecastFrom, to, { transactionsByScheduledItem: scheduledIndex, asOf }),
        )
        .filter((occurrence) => occurrence.status === 'scheduled')
    : [];

  const budgetPerMonth = includeCategoryBudgets
    ? list('categories')
        .filter((category) => category.kind === 'expense' && category.monthlyBudget)
        .reduce((total, category) => total + category.monthlyBudget, 0)
    : 0;

  let running = startingBalance;

  const series = d.buckets(from, to, granularity).map((bucket) => {
    const actualRows = actuals.filter(
      (transaction) =>
        d.isBetween(transaction.date, bucket.start, d.minDate(bucket.end, asOf)) &&
        d.cmp(transaction.date, asOf) <= 0,
    );
    const scheduledRows = forecast.filter((occurrence) =>
      d.isBetween(occurrence.date, bucket.start, bucket.end),
    );

    const actual = totalise(actualRows.map((transaction) => transaction.amount));
    const scheduled = totalise(scheduledRows.map((occurrence) => occurrence.amount));

    // Rough discretionary allowance for the future part of the bucket only.
    const futureDays = Math.max(
      0,
      d.diffDays(d.maxDate(bucket.start, d.addDays(asOf, 1)), bucket.end) + 1,
    );
    const bucketDays = d.diffDays(bucket.start, bucket.end) + 1;
    const estimatedDiscretionary =
      includeCategoryBudgets && futureDays > 0
        ? Math.round((budgetPerMonth * futureDays) / 30)
        : 0;

    const inflow = actual.inflow + scheduled.inflow;
    const outflow = actual.outflow + scheduled.outflow + estimatedDiscretionary;
    running += inflow - outflow;

    return {
      key: bucket.key,
      start: bucket.start,
      end: bucket.end,
      isProjected: d.cmp(bucket.end, asOf) > 0,
      isPartiallyProjected: d.cmp(bucket.start, asOf) <= 0 && d.cmp(bucket.end, asOf) > 0,
      daysInBucket: bucketDays,
      projectedDays: futureDays,
      actual: { ...actual, transactionCount: actualRows.length },
      scheduled: { ...scheduled, occurrenceCount: scheduledRows.length },
      estimatedDiscretionary,
      inflow,
      outflow,
      net: inflow - outflow,
      closingBalance: running,
    };
  });

  const lowest = series.reduce(
    (min, bucket) => (min === null || bucket.closingBalance < min.closingBalance ? bucket : min),
    null,
  );

  return {
    range: { from, to },
    granularity,
    currency,
    asOf,
    scope: { accountIds: ids },
    startingBalance,
    endingBalance: series.length ? series.at(-1).closingBalance : startingBalance,
    /** Where the forecast dips lowest — the number a user actually worries about. */
    lowestPoint: lowest
      ? { key: lowest.key, date: lowest.end, balance: lowest.closingBalance }
      : null,
    goesNegative: series.some((bucket) => bucket.closingBalance < 0),
    series,
    assumptions: {
      actualsThrough: asOf,
      forecastFrom,
      includesScheduled: includeScheduled,
      includesPendingInStartingBalance: true,
      excludesTransfers: true,
      /** True only if you asked for the crude discretionary estimate. */
      includesEstimatedDiscretionary: includeCategoryBudgets,
      monthlyCategoryBudgetTotal: includeCategoryBudgets ? budgetPerMonth : null,
      scheduledItemIds: [...new Set(forecast.map((occurrence) => occurrence.scheduledItemId))],
      note:
        'Actual transactions are used up to asOf; scheduled occurrences after it. Discretionary spending is not forecast unless includeCategoryBudgets=true.',
    },
  };
}

function totalise(amounts) {
  let inflow = 0;
  let outflow = 0;
  for (const amount of amounts) {
    if (amount > 0) inflow += amount;
    else outflow += -amount;
  }
  return { inflow, outflow, net: inflow - outflow };
}

/**
 * The flat "what's coming up" list: every occurrence of every scheduled item in a
 * window, annotated with posted / skipped / overdue / scheduled.
 */
export function upcoming({ from = d.today(), to, accountIds, projectIds, kinds, statuses }) {
  const scheduledIndex = transactionsByScheduledItem();

  const rows = list('scheduledItems')
    .filter((item) => {
      if (item.status !== 'active') return false;
      if (accountIds && !accountIds.includes(item.accountId)) return false;
      if (projectIds && !projectIds.includes(item.projectId)) return false;
      if (kinds && !kinds.includes(item.kind)) return false;
      return true;
    })
    .flatMap((item) => occurrences(item, from, to, { transactionsByScheduledItem: scheduledIndex }))
    .filter((occurrence) => !statuses || statuses.includes(occurrence.status))
    .sort((a, b) => d.cmp(a.date, b.date) || a.name.localeCompare(b.name));

  const totals = totalise(rows.filter((row) => row.status !== 'skipped').map((row) => row.amount));

  return {
    range: { from, to },
    occurrences: rows,
    totals: {
      ...totals,
      occurrenceCount: rows.length,
      overdueCount: rows.filter((row) => row.status === 'overdue').length,
    },
  };
}
