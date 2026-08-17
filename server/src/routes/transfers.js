import { Router } from 'express';
import { z } from 'zod';
import { store, list } from '../store/index.js';
import { requireRef } from '../lib/refs.js';
import { ApiError, notFound } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import * as d from '../lib/dates.js';
import { TRANSACTION_STATUSES, fields, parse } from '../lib/validate.js';

const router = Router();

/**
 * A transfer is not a third kind of record — it is two transactions sharing a
 * `transferId`, one negative and one positive. That keeps every account's ledger
 * complete on its own, and lets reports drop both legs with a single rule
 * ("has a transferId") instead of special-casing account pairs.
 */
const createSchema = z
  .object({
    fromAccountId: fields.id,
    toAccountId: fields.id,
    /** A positive magnitude. The sign of each leg is derived, not supplied. */
    amount: fields.minorAmount.positive('must be a positive number of minor units'),
    date: fields.calendarDate,
    description: z.string().trim().max(200).nullish(),
    notes: fields.optionalText,
    status: z.enum(TRANSACTION_STATUSES).default('posted'),
  })
  .strict();

router.get('/', (req, res) => {
  const legs = list('transactions').filter((transaction) => transaction.transferId);
  const grouped = new Map();

  for (const leg of legs) {
    const group = grouped.get(leg.transferId) ?? [];
    group.push(leg);
    grouped.set(leg.transferId, group);
  }

  const data = [...grouped.entries()]
    .map(([transferId, group]) => toTransfer(transferId, group))
    .sort((a, b) => d.cmp(b.date, a.date));

  res.json({ data, meta: { total: data.length } });
});

router.get('/:transferId', (req, res) => {
  const legs = list('transactions').filter(
    (transaction) => transaction.transferId === req.params.transferId,
  );
  if (!legs.length) throw notFound('Transfer', req.params.transferId);
  res.json({ data: toTransfer(req.params.transferId, legs) });
});

router.post('/', (req, res) => {
  const body = parse(createSchema, req.body ?? {});
  const from = requireRef('accounts', body.fromAccountId, 'fromAccountId');
  const to = requireRef('accounts', body.toAccountId, 'toAccountId');

  if (from.id === to.id) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid request body', [
      { path: 'toAccountId', code: 'same_account', message: 'A transfer needs two different accounts' },
    ]);
  }

  // No FX rates exist in this API, so a cross-currency transfer would have to
  // invent one. Refused loudly rather than guessed.
  if (from.currency !== to.currency) {
    throw new ApiError(
      422,
      'UNSUPPORTED_OPERATION',
      `Cross-currency transfers are not supported: '${from.id}' is ${from.currency} and '${to.id}' is ${to.currency}. ` +
        'Record two separate transactions and reconcile the rate yourself.',
    );
  }

  const transferId = id('tfr');
  const now = d.nowIso();
  const base = {
    date: body.date,
    currency: from.currency,
    merchant: null,
    categoryId: null,
    projectId: null,
    status: body.status,
    transferId,
    scheduledItemId: null,
    notes: body.notes ?? null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };

  const outLeg = {
    ...base,
    id: id('txn'),
    accountId: from.id,
    amount: -body.amount,
    description: body.description ?? `Transfer to ${to.name}`,
  };
  const inLeg = {
    ...base,
    id: id('txn'),
    accountId: to.id,
    amount: body.amount,
    description: body.description ?? `Transfer from ${from.name}`,
  };

  store.transactions.set(outLeg.id, outLeg);
  store.transactions.set(inLeg.id, inLeg);

  res.status(201).json({ data: toTransfer(transferId, [outLeg, inLeg]) });
});

/** Deleting a transfer removes both legs — a half-transfer is corrupt data. */
router.delete('/:transferId', (req, res) => {
  const legs = list('transactions').filter(
    (transaction) => transaction.transferId === req.params.transferId,
  );
  if (!legs.length) throw notFound('Transfer', req.params.transferId);

  for (const leg of legs) store.transactions.delete(leg.id);

  res.json({
    data: { deleted: { transactions: legs.length }, transferId: req.params.transferId },
  });
});

function toTransfer(transferId, legs) {
  const out = legs.find((leg) => leg.amount < 0) ?? legs[0];
  const into = legs.find((leg) => leg.amount > 0) ?? legs[1] ?? null;

  return {
    transferId,
    date: out.date,
    amount: Math.abs(out.amount),
    currency: out.currency,
    fromAccountId: out.accountId,
    toAccountId: into?.accountId ?? null,
    description: out.description,
    status: out.status,
    /** Both legs, so a client can link straight into either account's ledger. */
    legs: legs.map((leg) => ({ id: leg.id, accountId: leg.accountId, amount: leg.amount })),
    /** True when one leg was force-deleted — the ledger no longer balances. */
    isOrphaned: legs.length !== 2,
  };
}

export default router;
