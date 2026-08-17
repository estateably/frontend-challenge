import { Router } from 'express';
import { z } from 'zod';
import { store, list, require_ } from '../store/index.js';
import { filterTransactions } from '../services/query.js';
import { withRunningBalance } from '../services/balances.js';
import { INCLUDABLE, serializeTransaction } from '../lib/serialize.js';
import { optionalRef, requireRef } from '../lib/refs.js';
import { ApiError, badRequest, conflict } from '../lib/errors.js';
import { applySort, paginated, parsePagination, parseSort } from '../lib/paginate.js';
import { id } from '../lib/ids.js';
import * as d from '../lib/dates.js';
import {
  TRANSACTION_STATUSES,
  boolParam,
  dateParam,
  enumParam,
  fields,
  intParam,
  listParam,
  parse,
} from '../lib/validate.js';

const router = Router();

const SORTABLE = ['date', 'amount', 'description', 'merchant', 'status', 'createdAt', 'updatedAt', 'id'];

const createSchema = z
  .object({
    accountId: fields.id,
    date: fields.calendarDate,
    /** Integer minor units. Negative spends, positive receives. Zero is allowed. */
    amount: fields.minorAmount,
    description: fields.nonEmptyString,
    merchant: z.string().trim().max(120).nullish(),
    categoryId: fields.id.nullish(),
    projectId: fields.id.nullish(),
    status: z.enum(TRANSACTION_STATUSES).default('posted'),
    notes: fields.optionalText,
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    /** Optional, and only as an assertion — the account decides the currency. */
    currency: fields.currency.optional(),
  })
  .strict();

const patchSchema = createSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' });

/** Shared by create and update: references must exist, currency must agree. */
function resolveLinks(body, existing = null) {
  const account = body.accountId
    ? requireRef('accounts', body.accountId, 'accountId')
    : require_('accounts', existing.accountId);

  if (body.currency && body.currency !== account.currency) {
    throw new ApiError(422, 'CURRENCY_MISMATCH', 'Transaction currency must match its account', [
      {
        path: 'currency',
        code: 'currency_mismatch',
        message: `Account '${account.id}' is in ${account.currency}; received ${body.currency}. Omit currency — it is derived from the account.`,
      },
    ]);
  }

  optionalRef('categories', body.categoryId, 'categoryId');
  optionalRef('projects', body.projectId, 'projectId');

  return account;
}

/**
 * GET /api/transactions
 *
 * Filters (all optional, all combinable):
 *   accountId, categoryId, projectId, scheduledItemId, tag  repeatable or comma-separated
 *   status=posted|pending      from=YYYY-MM-DD    to=YYYY-MM-DD
 *   minAmount / maxAmount      signed minor units (-5000 is "spent $50 or more")
 *   direction=inflow|outflow   uncategorised=true (no category — the review queue)
 *   unassigned=true            (no project)
 *   includeTransfers=false     drop transfer legs
 *   transfersOnly=true         only transfer legs
 *   q=schwartz                 substring match over description, merchant, notes
 *
 * Shape:
 *   page/pageSize or offset/limit    sort=-date,amount    include=account,category
 *   withRunningBalance=true          single account, date-sorted only
 */
router.get('/', (req, res) => {
  const pagination = parsePagination(req.query);
  const sort = parseSort(req.query.sort, { allowed: SORTABLE, fallback: '-date,-createdAt' });
  const include = listParam(req.query.include) ?? [];

  for (const key of include) {
    if (!INCLUDABLE.includes(key)) {
      throw badRequest(`Cannot include '${key}'. Includable relations: ${INCLUDABLE.join(', ')}`);
    }
  }

  const accountIds = listParam(req.query.accountId);
  const filters = {
    accountIds,
    categoryIds: listParam(req.query.categoryId),
    projectIds: listParam(req.query.projectId),
    scheduledItemIds: listParam(req.query.scheduledItemId),
    tags: listParam(req.query.tag),
    statuses: listParam(req.query.status)?.map((status) =>
      enumParam(status, { name: 'status', allowed: TRANSACTION_STATUSES }),
    ),
    from: dateParam(req.query.from, { name: 'from' }),
    to: dateParam(req.query.to, { name: 'to' }),
    minAmount: intParam(req.query.minAmount, { name: 'minAmount' }),
    maxAmount: intParam(req.query.maxAmount, { name: 'maxAmount' }),
    search: req.query.q ? String(req.query.q) : undefined,
    uncategorised: req.query.uncategorised === undefined ? undefined : boolParam(req.query.uncategorised),
    unassigned: req.query.unassigned === undefined ? undefined : boolParam(req.query.unassigned),
    direction: req.query.direction
      ? enumParam(req.query.direction, { name: 'direction', allowed: ['inflow', 'outflow'] })
      : undefined,
    includeTransfers: boolParam(req.query.includeTransfers, true),
    transfersOnly: boolParam(req.query.transfersOnly, false),
  };

  if (filters.from && filters.to && d.cmp(filters.from, filters.to) > 0) {
    throw badRequest(`'from' (${filters.from}) must not be after 'to' (${filters.to})`);
  }

  const matched = filterTransactions(filters);
  const page = paginated(applySort(matched, sort), pagination);

  /**
   * Running balance is only defined for one account walked in date order, and it
   * is computed over the account's *whole* ledger — not just the filtered rows —
   * because a balance that ignores hidden transactions would be wrong.
   */
  let runningBalances = null;
  if (boolParam(req.query.withRunningBalance, false)) {
    if (!accountIds || accountIds.length !== 1) {
      throw badRequest(
        "'withRunningBalance' needs exactly one 'accountId': a running balance across several accounts has no meaning",
      );
    }
    if (sort[0].field !== 'date') {
      throw badRequest("'withRunningBalance' requires sorting by date (sort=date or sort=-date)");
    }
    const account = requireRef('accounts', accountIds[0], 'accountId');
    const ledger = list('transactions')
      .filter((transaction) => transaction.accountId === account.id)
      .sort((a, b) => d.cmp(a.date, b.date) || a.id.localeCompare(b.id));
    runningBalances = withRunningBalance(account, ledger);
  }

  res.set('X-Total-Count', String(page.meta.total));
  res.json({
    data: page.data.map((transaction) =>
      serializeTransaction(transaction, {
        include,
        ...(runningBalances ? { runningBalance: runningBalances.get(transaction.id) ?? null } : {}),
      }),
    ),
    meta: {
      ...page.meta,
      sort: sort.map(({ field, direction }) => `${direction === -1 ? '-' : ''}${field}`).join(','),
    },
  });
});

router.get('/:id', (req, res) => {
  const transaction = require_('transactions', req.params.id);
  const include = listParam(req.query.include) ?? [];
  res.json({ data: serializeTransaction(transaction, { include }) });
});

router.post('/', (req, res) => {
  const body = parse(createSchema, req.body ?? {});
  const account = resolveLinks(body);
  const transaction = build(body, account);

  store.transactions.set(transaction.id, transaction);
  res.status(201).json({ data: transaction });
});

/**
 * POST /api/transactions/bulk
 *
 * Partial success is the point: valid rows are created, invalid rows come back
 * with their index and reason, and the status code says which happened —
 * 201 all created, 207 some created, 422 none created.
 */
router.post('/bulk', (req, res) => {
  const body = parse(
    z.object({ transactions: z.array(z.unknown()).min(1).max(1000) }).strict(),
    req.body ?? {},
  );

  const created = [];
  const errors = [];

  body.transactions.forEach((raw, index) => {
    try {
      const parsed = parse(createSchema, raw);
      const account = resolveLinks(parsed);
      const transaction = build(parsed, account);
      store.transactions.set(transaction.id, transaction);
      created.push(transaction);
    } catch (error) {
      errors.push({
        index,
        error:
          error instanceof ApiError
            ? error.toJSON().error
            : { code: 'INTERNAL_ERROR', message: 'Could not create this transaction' },
      });
    }
  });

  const status = errors.length === 0 ? 201 : created.length === 0 ? 422 : 207;
  res.status(status).json({
    data: created,
    errors,
    meta: { requested: body.transactions.length, created: created.length, failed: errors.length },
  });
});

/**
 * POST /api/transactions/bulk-update
 * Categorising a screenful of rows at once — one request, not fifty.
 */
router.post('/bulk-update', (req, res) => {
  const body = parse(
    z
      .object({
        ids: z.array(fields.id).min(1).max(1000),
        patch: z
          .object({
            categoryId: fields.id.nullable(),
            projectId: fields.id.nullable(),
            status: z.enum(TRANSACTION_STATUSES),
            tags: z.array(z.string().trim().min(1).max(40)).max(20),
          })
          .partial()
          .strict()
          .refine((patch) => Object.keys(patch).length > 0, {
            message: 'Provide at least one field to update',
          }),
      })
      .strict(),
    req.body ?? {},
  );

  optionalRef('categories', body.patch.categoryId, 'patch.categoryId');
  optionalRef('projects', body.patch.projectId, 'patch.projectId');

  const updated = [];
  const notFound = [];

  for (const transactionId of body.ids) {
    const transaction = store.transactions.get(transactionId);
    if (!transaction) {
      notFound.push(transactionId);
      continue;
    }
    Object.assign(transaction, body.patch, { updatedAt: d.nowIso() });
    updated.push(transaction);
  }

  res.status(notFound.length && updated.length ? 207 : notFound.length ? 404 : 200).json({
    data: updated,
    errors: notFound.map((missing) => ({
      id: missing,
      error: { code: 'NOT_FOUND', message: `Transaction '${missing}' was not found` },
    })),
    meta: { requested: body.ids.length, updated: updated.length, failed: notFound.length },
  });
});

router.patch('/:id', (req, res) => {
  const transaction = require_('transactions', req.params.id);
  const body = parse(patchSchema, req.body ?? {});

  if (transaction.transferId && (body.amount !== undefined || body.accountId !== undefined)) {
    throw conflict(
      `Transaction '${transaction.id}' is one leg of transfer '${transaction.transferId}'. ` +
        'Changing its amount or account would unbalance the transfer — delete the transfer and create a new one instead.',
    );
  }

  resolveLinks(body, transaction);
  Object.assign(transaction, body, { updatedAt: d.nowIso() });
  res.json({ data: transaction });
});

router.delete('/:id', (req, res) => {
  const transaction = require_('transactions', req.params.id);

  if (transaction.transferId && !boolParam(req.query.force, false)) {
    throw conflict(
      `Transaction '${transaction.id}' is one leg of transfer '${transaction.transferId}'. ` +
        `Use DELETE /api/transfers/${transaction.transferId} to remove both legs, or ?force=true to orphan the other leg.`,
    );
  }

  store.transactions.delete(transaction.id);
  res.json({ data: { deleted: { transactions: 1 }, id: transaction.id } });
});

function build(body, account) {
  const now = d.nowIso();
  return {
    id: id('txn'),
    accountId: account.id,
    date: body.date,
    amount: body.amount,
    currency: account.currency,
    description: body.description,
    merchant: body.merchant ?? null,
    categoryId: body.categoryId ?? null,
    projectId: body.projectId ?? null,
    status: body.status,
    transferId: null,
    scheduledItemId: null,
    notes: body.notes ?? null,
    tags: body.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export default router;
