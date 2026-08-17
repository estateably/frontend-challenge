import { list } from '../store/index.js';
import * as d from '../lib/dates.js';

/**
 * One place where "which transactions?" is answered, shared by the transactions
 * endpoint and by every report. If filtering lived in the route, reports would
 * slowly grow their own subtly different version of it.
 *
 * A transaction is a *transfer leg* when it has a `transferId`. Transfers move
 * money between the user's own accounts, so they are neither income nor expense:
 * reports drop them by default, and the ledger keeps them.
 */
export function filterTransactions(filters = {}) {
  const {
    accountIds,
    categoryIds,
    projectIds,
    statuses,
    from,
    to,
    minAmount,
    maxAmount,
    search,
    uncategorised,
    unassigned,
    direction, // 'inflow' | 'outflow'
    includeTransfers = true,
    transfersOnly = false,
    scheduledItemIds,
    tags,
  } = filters;

  const needle = search?.trim().toLowerCase();

  return list('transactions').filter((transaction) => {
    if (accountIds && !accountIds.includes(transaction.accountId)) return false;
    if (categoryIds && !categoryIds.includes(transaction.categoryId)) return false;
    if (projectIds && !projectIds.includes(transaction.projectId)) return false;
    if (statuses && !statuses.includes(transaction.status)) return false;
    if (scheduledItemIds && !scheduledItemIds.includes(transaction.scheduledItemId)) return false;
    if (from && d.cmp(transaction.date, from) < 0) return false;
    if (to && d.cmp(transaction.date, to) > 0) return false;
    if (minAmount !== undefined && transaction.amount < minAmount) return false;
    if (maxAmount !== undefined && transaction.amount > maxAmount) return false;
    if (uncategorised === true && transaction.categoryId !== null) return false;
    if (uncategorised === false && transaction.categoryId === null) return false;
    if (unassigned === true && transaction.projectId !== null) return false;
    if (direction === 'inflow' && transaction.amount <= 0) return false;
    if (direction === 'outflow' && transaction.amount >= 0) return false;
    if (transfersOnly && !transaction.transferId) return false;
    if (!includeTransfers && transaction.transferId) return false;
    if (tags && !tags.some((tag) => transaction.tags.includes(tag))) return false;

    if (needle) {
      const haystack = `${transaction.description} ${transaction.merchant ?? ''} ${transaction.notes ?? ''}`;
      if (!haystack.toLowerCase().includes(needle)) return false;
    }

    return true;
  });
}

/** Accounts a report should cover: one currency, optionally narrowed, archived excluded. */
export function accountsInScope({ currency, accountIds, includeArchived = false } = {}) {
  return list('accounts').filter((account) => {
    if (currency && account.currency !== currency) return false;
    if (accountIds && !accountIds.includes(account.id)) return false;
    if (!includeArchived && account.archivedAt) return false;
    return true;
  });
}

export function transactionsByScheduledItem() {
  const index = new Map();
  for (const transaction of list('transactions')) {
    if (!transaction.scheduledItemId) continue;
    const bucket = index.get(transaction.scheduledItemId) ?? [];
    bucket.push(transaction);
    index.set(transaction.scheduledItemId, bucket);
  }
  return index;
}
