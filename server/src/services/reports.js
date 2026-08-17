import { find, list } from '../store/index.js';
import * as d from '../lib/dates.js';
import { accountsInScope, filterTransactions, transactionsByScheduledItem } from './query.js';
import { occurrences } from './recurrence.js';

/**
 * Reporting vocabulary, used identically by every report and projection:
 *
 *   outflow  sum of the magnitudes of money leaving  (always >= 0)
 *   inflow   sum of the magnitudes of money arriving (always >= 0)
 *   net      inflow - outflow (signed: negative means you spent more than you earned)
 *
 * Classification is by the *sign of the amount*, never by the category's kind.
 * A refund is a positive amount, so it lands in `inflow` even if its category is
 * an expense one — which is why every row carries all three numbers and the
 * client can decide whether to show gross or net.
 *
 * Two exclusions apply by default and are always reported back in `excluded`:
 *
 *   transfer legs      money between the user's own accounts is not income or
 *                      expense; counting it double-counts everything
 *   other currencies   a report covers exactly one currency, because this API has
 *                      no FX rates and a mixed sum would be a lie
 */
function scope({ currency, accountIds, includePending, includeTransfers, projectIds, from, to }) {
  const accounts = accountsInScope({ currency, accountIds });
  const ids = accounts.map((account) => account.id);
  const statuses = includePending ? ['posted', 'pending'] : ['posted'];

  const transactions = filterTransactions({
    accountIds: ids,
    projectIds,
    statuses,
    from,
    to,
    includeTransfers,
  });

  // Count what we dropped, so a client can surface "12 transfers excluded"
  // instead of quietly losing the money.
  const all = filterTransactions({ from, to });
  const sameCurrency = new Set(
    list('accounts')
      .filter((account) => account.currency === currency)
      .map((account) => account.id),
  );

  const excluded = {
    transferLegs: all.filter((t) => t.transferId && ids.includes(t.accountId)).length,
    otherCurrencyTransactions: all.filter((t) => !sameCurrency.has(t.accountId)).length,
    /** Right currency, still out of scope: archived, or filtered out by accountId. */
    outOfScopeTransactions: all.filter((t) => sameCurrency.has(t.accountId) && !ids.includes(t.accountId))
      .length,
    pendingTransactions: includePending
      ? 0
      : all.filter((t) => t.status === 'pending' && ids.includes(t.accountId)).length,
  };

  return { accounts, accountIds: ids, transactions, excluded };
}

const CATEGORY_LABEL = { categoryId: null, name: 'Uncategorised', parentId: null, kind: null, color: '#a1a1aa' };

function categoryRow(categoryId) {
  if (categoryId === null) return { ...CATEGORY_LABEL };
  const category = find('categories', categoryId);
  return category
    ? {
        categoryId: category.id,
        name: category.name,
        parentId: category.parentId,
        kind: category.kind,
        color: category.color,
        monthlyBudget: category.monthlyBudget,
      }
    : { categoryId, name: categoryId, parentId: null, kind: null, color: '#a1a1aa' };
}

function tally(transactions) {
  const byCategory = new Map();
  let inflow = 0;
  let outflow = 0;

  for (const transaction of transactions) {
    const row = byCategory.get(transaction.categoryId) ?? {
      ...categoryRow(transaction.categoryId),
      inflow: 0,
      outflow: 0,
      net: 0,
      transactionCount: 0,
    };

    if (transaction.amount > 0) {
      row.inflow += transaction.amount;
      inflow += transaction.amount;
    } else {
      row.outflow += -transaction.amount;
      outflow += -transaction.amount;
    }

    row.net = row.inflow - row.outflow;
    row.transactionCount += 1;
    byCategory.set(transaction.categoryId, row);
  }

  const rows = [...byCategory.values()].sort((a, b) => b.outflow - a.outflow || b.inflow - a.inflow);
  return { inflow, outflow, net: inflow - outflow, byCategory: rows };
}

/** Adds budget comparison to category rows. `null` budget means "not budgeted". */
function withBudget(rows, months = 1) {
  return rows.map((row) => {
    const budget = row.monthlyBudget ?? null;
    if (budget === null) {
      return { ...row, budget: null, budgetRemaining: null, budgetUsedRatio: null, overBudget: false };
    }
    const scaled = budget * months;
    return {
      ...row,
      budget: scaled,
      budgetRemaining: scaled - row.outflow,
      budgetUsedRatio: scaled === 0 ? null : Number((row.outflow / scaled).toFixed(4)),
      overBudget: row.outflow > scaled,
    };
  });
}

/**
 * User story 3: expenses by category, per month.
 * `from`/`to` are months (`YYYY-MM`) because that is the unit the report is about.
 */
export function monthlyExpenses({
  from,
  to,
  currency,
  accountIds,
  projectIds,
  includePending = true,
  includeTransfers = false,
}) {
  const startDate = d.monthStart(from);
  const endDate = d.monthEnd(to);
  const { accountIds: ids, transactions, excluded } = scope({
    currency,
    accountIds,
    includePending,
    includeTransfers,
    projectIds,
    from: startDate,
    to: endDate,
  });

  const grouped = new Map();
  for (const transaction of transactions) {
    const key = d.monthKey(transaction.date);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(transaction);
  }

  const months = d.buckets(startDate, endDate, 'month').map((bucket) => {
    const rows = grouped.get(bucket.key) ?? [];
    const totals = tally(rows);
    return {
      month: bucket.key,
      start: bucket.start,
      end: bucket.end,
      inflow: totals.inflow,
      outflow: totals.outflow,
      net: totals.net,
      transactionCount: rows.length,
      byCategory: withBudget(totals.byCategory, 1),
    };
  });

  const totals = tally(transactions);

  return {
    range: { from, to, startDate, endDate },
    currency,
    scope: {
      accountIds: ids,
      includesPending: includePending,
      includesTransfers: includeTransfers,
      projectIds: projectIds ?? null,
    },
    months,
    totals: {
      inflow: totals.inflow,
      outflow: totals.outflow,
      net: totals.net,
      transactionCount: transactions.length,
      monthCount: months.length,
      averageMonthlyOutflow: months.length ? Math.round(totals.outflow / months.length) : 0,
      byCategory: withBudget(totals.byCategory, months.length),
    },
    excluded,
  };
}

/** Category totals for an arbitrary date range, with each category's share of outflow. */
export function categoryBreakdown({
  from,
  to,
  currency,
  accountIds,
  projectIds,
  includePending = true,
  includeTransfers = false,
}) {
  const { accountIds: ids, transactions, excluded } = scope({
    currency,
    accountIds,
    includePending,
    includeTransfers,
    projectIds,
    from,
    to,
  });

  const totals = tally(transactions);
  const categories = withBudget(totals.byCategory, 1).map((row) => ({
    ...row,
    outflowShare: totals.outflow === 0 ? 0 : Number((row.outflow / totals.outflow).toFixed(4)),
  }));

  return {
    range: { from, to },
    currency,
    scope: { accountIds: ids, includesPending: includePending, includesTransfers: includeTransfers },
    inflow: totals.inflow,
    outflow: totals.outflow,
    net: totals.net,
    transactionCount: transactions.length,
    categories,
    excluded,
  };
}

/** Inflow / outflow / net per bucket — the shape a cash-flow bar chart wants. */
export function cashFlow({
  from,
  to,
  granularity = 'month',
  currency,
  accountIds,
  includePending = true,
  includeTransfers = false,
}) {
  const { accountIds: ids, transactions, excluded } = scope({
    currency,
    accountIds,
    includePending,
    includeTransfers,
    from,
    to,
  });

  const series = d.buckets(from, to, granularity).map((bucket) => {
    const rows = transactions.filter((transaction) =>
      d.isBetween(transaction.date, bucket.start, bucket.end),
    );
    const totals = tally(rows);
    return {
      key: bucket.key,
      start: bucket.start,
      end: bucket.end,
      inflow: totals.inflow,
      outflow: totals.outflow,
      net: totals.net,
      transactionCount: rows.length,
      // Share of income kept. Meaningless without income, hence null.
      savingsRate:
        totals.inflow === 0 ? null : Number(((totals.inflow - totals.outflow) / totals.inflow).toFixed(4)),
    };
  });

  const totals = tally(transactions);

  return {
    range: { from, to },
    granularity,
    currency,
    scope: { accountIds: ids, includesPending: includePending, includesTransfers: includeTransfers },
    series,
    totals: { inflow: totals.inflow, outflow: totals.outflow, net: totals.net },
    excluded,
  };
}

/**
 * User story 5: everything spent against one project, plus what is still coming.
 * Project spend deliberately ignores account currency filtering — a project has
 * its own currency, and mixing is reported rather than hidden.
 */
export function projectSummary(project) {
  const transactions = filterTransactions({ projectIds: [project.id] });
  const totals = tally(transactions);

  const byMonth = new Map();
  for (const transaction of transactions) {
    const key = d.monthKey(transaction.date);
    const row = byMonth.get(key) ?? { month: key, inflow: 0, outflow: 0, net: 0, transactionCount: 0 };
    if (transaction.amount > 0) row.inflow += transaction.amount;
    else row.outflow += -transaction.amount;
    row.net = row.inflow - row.outflow;
    row.transactionCount += 1;
    byMonth.set(key, row);
  }

  const scheduledIndex = transactionsByScheduledItem();
  const horizon = project.endDate ?? d.addMonths(d.today(), 12);
  const upcoming = list('scheduledItems')
    .filter((item) => item.projectId === project.id && item.status === 'active')
    .flatMap((item) =>
      occurrences(item, d.addDays(d.today(), 1), horizon, {
        transactionsByScheduledItem: scheduledIndex,
      }),
    )
    .filter((occurrence) => occurrence.status === 'scheduled')
    .sort((a, b) => d.cmp(a.date, b.date));

  const committed = upcoming.reduce((total, occurrence) => total + Math.abs(occurrence.amount), 0);
  const spent = totals.outflow - totals.inflow;
  const currencies = [...new Set(transactions.map((transaction) => transaction.currency))];

  return {
    projectId: project.id,
    currency: project.currency,
    budget: project.budget,
    outflow: totals.outflow,
    inflow: totals.inflow,
    /** Net cash out the door: outflow less refunds. This is what to compare to budget. */
    spent,
    committed,
    projectedTotal: spent + committed,
    budgetRemaining: project.budget === null ? null : project.budget - spent,
    budgetUsedRatio:
      project.budget === null || project.budget === 0
        ? null
        : Number((spent / project.budget).toFixed(4)),
    overBudget: project.budget !== null && spent > project.budget,
    transactionCount: transactions.length,
    firstTransactionDate: transactions.length
      ? transactions.reduce((min, t) => d.minDate(min, t.date), transactions[0].date)
      : null,
    lastTransactionDate: transactions.length
      ? transactions.reduce((max, t) => d.maxDate(max, t.date), transactions[0].date)
      : null,
    byCategory: totals.byCategory,
    byMonth: [...byMonth.values()].sort((a, b) => d.cmp(a.month, b.month)),
    upcoming,
    /** More than one entry here means the totals above mix currencies. */
    currenciesInvolved: currencies,
  };
}
