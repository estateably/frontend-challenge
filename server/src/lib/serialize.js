import { find } from '../store/index.js';
import { nextDueDate } from '../services/recurrence.js';

/**
 * Responses return foreign keys, not nested objects, by default: a ledger page
 * would otherwise repeat the same account and category bodies hundreds of times.
 * `?include=account,category,project` opts into embedding when a screen needs it.
 */
export const INCLUDABLE = ['account', 'category', 'project', 'scheduledItem'];

const summary = (record, extra = []) =>
  record === null
    ? null
    : Object.fromEntries(
        ['id', 'name', 'currency', 'color', ...extra]
          .filter((key) => key in record)
          .map((key) => [key, record[key]]),
      );

export function serializeTransaction(transaction, { include = [], runningBalance } = {}) {
  const out = { ...transaction };

  if (include.includes('account')) out.account = summary(find('accounts', transaction.accountId), ['type']);
  if (include.includes('category')) out.category = summary(find('categories', transaction.categoryId), ['kind', 'parentId']);
  if (include.includes('project')) out.project = summary(find('projects', transaction.projectId), ['status']);
  if (include.includes('scheduledItem')) out.scheduledItem = summary(find('scheduledItems', transaction.scheduledItemId), ['frequency']);
  if (runningBalance !== undefined) out.runningBalance = runningBalance;

  return out;
}

/** `nextDueDate` is derived on read so it can never go stale in the store. */
export function serializeScheduledItem(item) {
  return { ...item, nextDueDate: nextDueDate(item) };
}
