import { Router } from 'express';
import { z } from 'zod';
import { store, list, require_ } from '../store/index.js';
import { occurrenceDates, occurrences } from '../services/recurrence.js';
import { upcoming } from '../services/projections.js';
import { transactionsByScheduledItem } from '../services/query.js';
import { serializeScheduledItem } from '../lib/serialize.js';
import { optionalRef, requireRef } from '../lib/refs.js';
import { ApiError, conflict } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import * as d from '../lib/dates.js';
import {
  FREQUENCIES,
  SCHEDULED_KINDS,
  TRANSACTION_STATUSES,
  dateParam,
  enumParam,
  fields,
  listParam,
  parse,
} from '../lib/validate.js';

const router = Router();

const OCCURRENCE_STATUSES = ['posted', 'skipped', 'overdue', 'scheduled'];

/**
 * Future bills and income (user story 4).
 *
 * A scheduled item is a *rule*, not a row: `startDate` + `frequency` generate
 * dates on demand. Nothing is materialised in advance, so changing an item
 * instantly changes the whole forecast, and there is no queue of stale future
 * rows to migrate. The cost is that "mark this one as paid" needs somewhere to
 * live — that is `postedOccurrences` and `skippedDates`, keyed by date.
 *
 * Monthly-family items stay anchored to their day of month and clamp in short
 * months: an item due on the 31st falls on Feb 28, then back on Mar 31.
 */
const createSchema = z
  .object({
    name: fields.nonEmptyString,
    kind: z.enum(SCHEDULED_KINDS),
    accountId: fields.id,
    categoryId: fields.id.nullish(),
    projectId: fields.id.nullish(),
    /** Signed, like a transaction: bills negative, income positive. */
    amount: fields.minorAmount,
    frequency: z.enum(FREQUENCIES),
    /** First occurrence. For monthly-family items this also fixes the day of month. */
    startDate: fields.calendarDate,
    endDate: fields.calendarDate.nullish(),
    autoPay: z.boolean().default(false),
    status: z.enum(['active', 'paused']).default('active'),
    notes: fields.optionalText,
    /** Expected swing around `amount`, in minor units. Documentation for humans. */
    variance: fields.minorAmount.nonnegative().default(0),
  })
  .strict();

const patchSchema = createSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' });

function assertSignMatchesKind(kind, amount) {
  if (kind === 'bill' && amount > 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid request body', [
      { path: 'amount', code: 'sign_mismatch', message: "A bill must be negative (money leaving the account)" },
    ]);
  }
  if (kind === 'income' && amount < 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid request body', [
      { path: 'amount', code: 'sign_mismatch', message: 'Income must be positive (money arriving)' },
    ]);
  }
}

router.get('/', (req, res) => {
  const kinds = listParam(req.query.kind)?.map((kind) =>
    enumParam(kind, { name: 'kind', allowed: SCHEDULED_KINDS }),
  );
  const statuses = listParam(req.query.status);
  const accountIds = listParam(req.query.accountId);
  const projectIds = listParam(req.query.projectId);

  const items = list('scheduledItems')
    .filter((item) => (kinds ? kinds.includes(item.kind) : true))
    .filter((item) => (statuses ? statuses.includes(item.status) : true))
    .filter((item) => (accountIds ? accountIds.includes(item.accountId) : true))
    .filter((item) => (projectIds ? projectIds.includes(item.projectId) : true))
    .map(serializeScheduledItem)
    .sort((a, b) => d.cmp(a.nextDueDate ?? '9999-12-31', b.nextDueDate ?? '9999-12-31'));

  res.json({ data: items, meta: { total: items.length, today: d.today() } });
});

/**
 * GET /api/scheduled-items/occurrences?from&to
 * The flat upcoming-bills list: every rule expanded into dates, each annotated
 * posted / skipped / overdue / scheduled. Declared before /:id.
 */
router.get('/occurrences', (req, res) => {
  const from = dateParam(req.query.from, { name: 'from', fallback: d.today() });
  const to = dateParam(req.query.to, { name: 'to', fallback: d.addMonths(from, 3) });
  const statuses = listParam(req.query.status)?.map((status) =>
    enumParam(status, { name: 'status', allowed: OCCURRENCE_STATUSES }),
  );

  res.json(
    upcoming({
      from,
      to,
      accountIds: listParam(req.query.accountId),
      projectIds: listParam(req.query.projectId),
      kinds: listParam(req.query.kind)?.map((kind) =>
        enumParam(kind, { name: 'kind', allowed: SCHEDULED_KINDS }),
      ),
      statuses,
    }),
  );
});

router.get('/:id', (req, res) => {
  const item = require_('scheduledItems', req.params.id);
  res.json({ data: serializeScheduledItem(item) });
});

/** GET /api/scheduled-items/:id/occurrences — one rule's dates, with their status. */
router.get('/:id/occurrences', (req, res) => {
  const item = require_('scheduledItems', req.params.id);
  const from = dateParam(req.query.from, { name: 'from', fallback: item.startDate });
  const to = dateParam(req.query.to, { name: 'to', fallback: d.addMonths(d.today(), 6) });

  res.json({
    data: occurrences(item, from, to, { transactionsByScheduledItem: transactionsByScheduledItem() }),
    meta: { range: { from, to }, scheduledItemId: item.id },
  });
});

router.post('/', (req, res) => {
  const body = parse(createSchema, req.body ?? {});
  const account = requireRef('accounts', body.accountId, 'accountId');
  optionalRef('categories', body.categoryId, 'categoryId');
  optionalRef('projects', body.projectId, 'projectId');
  assertSignMatchesKind(body.kind, body.amount);

  if (body.endDate && d.cmp(body.startDate, body.endDate) > 0) {
    throw conflict(`'startDate' (${body.startDate}) must not be after 'endDate' (${body.endDate})`);
  }

  const now = d.nowIso();
  const item = {
    id: id('sch'),
    name: body.name,
    kind: body.kind,
    accountId: account.id,
    categoryId: body.categoryId ?? null,
    projectId: body.projectId ?? null,
    amount: body.amount,
    currency: account.currency,
    frequency: body.frequency,
    startDate: body.startDate,
    endDate: body.endDate ?? null,
    autoPay: body.autoPay,
    status: body.status,
    notes: body.notes ?? null,
    variance: body.variance,
    skippedDates: [],
    postedOccurrences: [],
    createdAt: now,
    updatedAt: now,
  };

  store.scheduledItems.set(item.id, item);
  res.status(201).json({ data: serializeScheduledItem(item) });
});

router.patch('/:id', (req, res) => {
  const item = require_('scheduledItems', req.params.id);
  const body = parse(patchSchema, req.body ?? {});

  const account = body.accountId ? requireRef('accounts', body.accountId, 'accountId') : null;
  optionalRef('categories', body.categoryId, 'categoryId');
  optionalRef('projects', body.projectId, 'projectId');
  assertSignMatchesKind(body.kind ?? item.kind, body.amount ?? item.amount);

  Object.assign(item, body, {
    ...(account ? { currency: account.currency } : {}),
    updatedAt: d.nowIso(),
  });
  res.json({ data: serializeScheduledItem(item) });
});

router.delete('/:id', (req, res) => {
  const item = require_('scheduledItems', req.params.id);
  const linked = list('transactions').filter(
    (transaction) => transaction.scheduledItemId === item.id,
  );

  // The transactions it already produced are real money and stay put; they just
  // stop pointing at a rule that no longer exists.
  for (const transaction of linked) {
    transaction.scheduledItemId = null;
    transaction.updatedAt = d.nowIso();
  }

  store.scheduledItems.delete(item.id);
  res.json({ data: { deleted: { scheduledItems: 1 }, unlinked: { transactions: linked.length } } });
});

/**
 * POST /api/scheduled-items/:id/post
 * Turns one occurrence into a real transaction ("mark this bill paid"). The
 * amount defaults to the scheduled amount but can differ — the hydro bill never
 * matches the estimate — and the occurrence stops appearing in projections.
 */
router.post('/:id/post', (req, res) => {
  const item = require_('scheduledItems', req.params.id);
  const body = parse(
    z
      .object({
        date: fields.calendarDate,
        amount: fields.minorAmount.optional(),
        status: z.enum(TRANSACTION_STATUSES).default('posted'),
        description: fields.nonEmptyString.optional(),
        notes: fields.optionalText,
      })
      .strict(),
    req.body ?? {},
  );

  assertIsOccurrence(item, body.date);

  if ((item.postedOccurrences ?? []).some((entry) => entry.date === body.date)) {
    throw conflict(`The ${body.date} occurrence of '${item.id}' has already been posted`);
  }

  const account = require_('accounts', item.accountId);
  const now = d.nowIso();
  const transaction = {
    id: id('txn'),
    accountId: account.id,
    date: body.date,
    amount: body.amount ?? item.amount,
    currency: account.currency,
    description: body.description ?? item.name,
    merchant: null,
    categoryId: item.categoryId,
    projectId: item.projectId,
    status: body.status,
    transferId: null,
    scheduledItemId: item.id,
    notes: body.notes ?? null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };

  store.transactions.set(transaction.id, transaction);
  item.postedOccurrences = [
    ...(item.postedOccurrences ?? []),
    { date: body.date, transactionId: transaction.id },
  ];
  item.updatedAt = now;

  res.status(201).json({ data: { transaction, scheduledItem: serializeScheduledItem(item) } });
});

/** POST /api/scheduled-items/:id/skip — dismiss one date without deleting the rule. */
router.post('/:id/skip', (req, res) => {
  const item = require_('scheduledItems', req.params.id);
  const body = parse(z.object({ date: fields.calendarDate }).strict(), req.body ?? {});

  assertIsOccurrence(item, body.date);
  if (!item.skippedDates.includes(body.date)) item.skippedDates.push(body.date);
  item.updatedAt = d.nowIso();

  res.json({ data: serializeScheduledItem(item) });
});

router.post('/:id/unskip', (req, res) => {
  const item = require_('scheduledItems', req.params.id);
  const body = parse(z.object({ date: fields.calendarDate }).strict(), req.body ?? {});

  item.skippedDates = item.skippedDates.filter((date) => date !== body.date);
  item.updatedAt = d.nowIso();

  res.json({ data: serializeScheduledItem(item) });
});

/** Guards against posting a bill on a date the rule never generates. */
function assertIsOccurrence(item, date) {
  const dates = occurrenceDates(item, d.addMonths(date, -1), d.addMonths(date, 1));
  if (!dates.includes(date)) {
    throw new ApiError(422, 'NOT_AN_OCCURRENCE', `'${item.name}' does not fall on ${date}`, [
      {
        path: 'date',
        code: 'not_an_occurrence',
        message: `Nearby occurrences: ${dates.join(', ') || 'none'}`,
      },
    ]);
  }
}

export default router;
