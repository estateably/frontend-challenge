import { list } from '../store/index.js';
import * as d from '../lib/dates.js';

/**
 * Balances are always *derived* — never stored. There is no `balance` column to
 * fall out of sync with the ledger, and asking for a balance "as of" any past
 * date is the same code path as asking for today's.
 *
 * Three numbers, because "the balance" is ambiguous once pending rows exist:
 *
 *   posted    opening balance + every posted transaction up to `asOf`
 *   pending   the pending rows on their own (usually negative)
 *   available posted + pending — what the money is really doing
 */
export function accountBalance(account, asOf = d.today(), transactions = null) {
  const rows = (transactions ?? list('transactions')).filter(
    (transaction) => transaction.accountId === account.id && d.cmp(transaction.date, asOf) <= 0,
  );

  let posted = account.openingBalance;
  let pending = 0;
  let pendingCount = 0;

  for (const transaction of rows) {
    if (transaction.status === 'pending') {
      pending += transaction.amount;
      pendingCount += 1;
    } else {
      posted += transaction.amount;
    }
  }

  const available = posted + pending;

  return {
    accountId: account.id,
    currency: account.currency,
    asOf,
    openingBalance: account.openingBalance,
    posted,
    pending,
    available,
    transactionCount: rows.length,
    pendingCount,
    creditLimit: account.creditLimit,
    // For a credit card the balance is negative when money is owed, so the room
    // left on the card is limit + balance.
    availableCredit: account.creditLimit === null ? null : account.creditLimit + available,
  };
}

/**
 * Balances for many accounts plus per-currency totals.
 *
 * Totals are grouped by currency and never summed across them: there is no FX
 * rate in this API, and inventing one would quietly produce wrong numbers.
 */
export function balanceSnapshot(accounts, asOf = d.today()) {
  const transactions = list('transactions');
  const balances = accounts.map((account) => accountBalance(account, asOf, transactions));

  const totalsByCurrency = {};
  for (const balance of balances) {
    const total = (totalsByCurrency[balance.currency] ??= {
      currency: balance.currency,
      posted: 0,
      pending: 0,
      available: 0,
      accountCount: 0,
    });
    total.posted += balance.posted;
    total.pending += balance.pending;
    total.available += balance.available;
    total.accountCount += 1;
  }

  return { asOf, balances, totalsByCurrency };
}

/**
 * Closing balance per bucket — the series behind a balance-over-time chart.
 * Computed by walking the ledger once in date order rather than re-summing per
 * bucket, so a five-year daily history stays cheap.
 */
export function balanceHistory(account, from, to, granularity = 'month') {
  const rows = list('transactions')
    .filter((transaction) => transaction.accountId === account.id && d.cmp(transaction.date, to) <= 0)
    .sort((a, b) => d.cmp(a.date, b.date));

  const series = [];
  let running = account.openingBalance;
  let cursor = 0;

  // Everything before the window collapses into the opening figure.
  while (cursor < rows.length && d.cmp(rows[cursor].date, from) < 0) {
    running += rows[cursor].amount;
    cursor += 1;
  }

  const openingBalance = running;

  for (const bucket of d.buckets(from, to, granularity)) {
    let inflow = 0;
    let outflow = 0;

    while (cursor < rows.length && d.cmp(rows[cursor].date, bucket.end) <= 0) {
      const { amount } = rows[cursor];
      if (amount > 0) inflow += amount;
      else outflow += -amount;
      running += amount;
      cursor += 1;
    }

    series.push({
      key: bucket.key,
      start: bucket.start,
      end: bucket.end,
      inflow,
      outflow,
      net: inflow - outflow,
      closingBalance: running,
    });
  }

  return {
    accountId: account.id,
    currency: account.currency,
    granularity,
    range: { from, to },
    openingBalance,
    series,
  };
}

/**
 * Running balance per row, for a single account in date order.
 *
 * Cumulative values can't be computed from one page of results — the client
 * would need every earlier row — so the server offers it. Pending rows get
 * `null`: they haven't settled, so there is no defensible running total for them.
 */
export function withRunningBalance(account, sortedAscending) {
  let running = account.openingBalance;

  const balances = new Map();
  for (const transaction of sortedAscending) {
    if (transaction.status === 'pending') {
      balances.set(transaction.id, null);
      continue;
    }
    running += transaction.amount;
    balances.set(transaction.id, running);
  }

  return balances;
}
