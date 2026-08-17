import { Router } from 'express';
import { z } from 'zod';
import { store, list, require_ } from '../store/index.js';
import { accountBalance, balanceHistory, balanceSnapshot } from '../services/balances.js';
import { filterTransactions } from '../services/query.js';
import * as d from '../lib/dates.js';
import { conflict } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import {
  ACCOUNT_TYPES,
  GRANULARITIES,
  boolParam,
  dateParam,
  enumParam,
  fields,
  listParam,
  parse,
} from '../lib/validate.js';

const router = Router();

const createSchema = z
  .object({
    name: fields.nonEmptyString,
    type: z.enum(ACCOUNT_TYPES),
    currency: fields.currency.default('CAD'),
    institution: z.string().trim().max(120).nullish(),
    /** The balance before the first transaction in the ledger. */
    openingBalance: fields.minorAmount.default(0),
    openedAt: fields.calendarDate.optional(),
    /** Credit cards only, stored as a positive number. */
    creditLimit: fields.minorAmount.nonnegative().nullish(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex colour like #2563eb')
      .nullish(),
  })
  .strict();

const patchSchema = createSchema
  .omit({ currency: true })
  .partial()
  .extend({ archivedAt: fields.calendarDate.nullish() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' });

/**
 * GET /api/accounts
 * Balances are attached by default — user story 2 is "see the balance for each
 * account", and making the client fan out N requests for it would be a worse
 * default than one slightly larger response.
 */
router.get('/', (req, res) => {
  const asOf = dateParam(req.query.asOf, { name: 'asOf', fallback: d.today() });
  const withBalances = boolParam(req.query.includeBalances, true);
  const includeArchived = boolParam(req.query.includeArchived, false);
  const types = listParam(req.query.type);
  const currencies = listParam(req.query.currency);

  const accounts = list('accounts')
    .filter((account) => (includeArchived ? true : !account.archivedAt))
    .filter((account) => (types ? types.includes(account.type) : true))
    .filter((account) => (currencies ? currencies.includes(account.currency) : true))
    .sort((a, b) => a.name.localeCompare(b.name));

  const snapshot = withBalances ? balanceSnapshot(accounts, asOf) : null;
  const byId = new Map(snapshot?.balances.map((balance) => [balance.accountId, balance]) ?? []);

  res.json({
    data: accounts.map((account) => ({
      ...account,
      balance: byId.get(account.id) ?? null,
    })),
    meta: {
      total: accounts.length,
      asOf,
      totalsByCurrency: snapshot?.totalsByCurrency ?? null,
    },
  });
});

/**
 * GET /api/accounts/balances
 * Every balance plus per-currency totals in one call — the dashboard header.
 * Declared before /:id so "balances" is not read as an account id.
 */
router.get('/balances', (req, res) => {
  const asOf = dateParam(req.query.asOf, { name: 'asOf', fallback: d.today() });
  const includeArchived = boolParam(req.query.includeArchived, false);
  const accounts = list('accounts').filter((account) => includeArchived || !account.archivedAt);
  res.json(balanceSnapshot(accounts, asOf));
});

router.get('/:id', (req, res) => {
  const account = require_('accounts', req.params.id);
  const asOf = dateParam(req.query.asOf, { name: 'asOf', fallback: d.today() });
  res.json({ data: { ...account, balance: accountBalance(account, asOf) } });
});

/** GET /api/accounts/:id/balance?asOf=YYYY-MM-DD — the balance at any point in time. */
router.get('/:id/balance', (req, res) => {
  const account = require_('accounts', req.params.id);
  const asOf = dateParam(req.query.asOf, { name: 'asOf', fallback: d.today() });
  res.json({ data: accountBalance(account, asOf) });
});

/** GET /api/accounts/:id/balance-history — closing balance per day/week/month/year. */
router.get('/:id/balance-history', (req, res) => {
  const account = require_('accounts', req.params.id);
  const to = dateParam(req.query.to, { name: 'to', fallback: d.today() });
  const from = dateParam(req.query.from, {
    name: 'from',
    fallback: d.startOfMonth(d.addMonths(to, -11)),
  });
  const granularity = enumParam(req.query.granularity, {
    name: 'granularity',
    allowed: GRANULARITIES,
    fallback: 'month',
  });

  res.json({ data: balanceHistory(account, from, to, granularity) });
});

router.post('/', (req, res) => {
  const body = parse(createSchema, req.body ?? {});
  const now = d.nowIso();

  const account = {
    id: id('acc'),
    name: body.name,
    type: body.type,
    institution: body.institution ?? null,
    currency: body.currency,
    openingBalance: body.openingBalance,
    creditLimit: body.creditLimit ?? null,
    color: body.color ?? '#64748b',
    openedAt: body.openedAt ?? d.today(),
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  store.accounts.set(account.id, account);
  res.status(201).json({ data: { ...account, balance: accountBalance(account) } });
});

router.patch('/:id', (req, res) => {
  const account = require_('accounts', req.params.id);
  const body = parse(patchSchema, req.body ?? {});

  // Currency is immutable: changing it would silently reinterpret every
  // historical amount on the account.
  Object.assign(account, body, { updatedAt: d.nowIso() });
  res.json({ data: { ...account, balance: accountBalance(account) } });
});

/**
 * DELETE /api/accounts/:id
 * Refuses while transactions exist — deleting an account should not silently
 * delete history. `?force=true` cascades (transactions and scheduled items go
 * too) and reports what it removed.
 */
router.delete('/:id', (req, res) => {
  const account = require_('accounts', req.params.id);
  const force = boolParam(req.query.force, false);
  const transactions = filterTransactions({ accountIds: [account.id] });
  const scheduled = list('scheduledItems').filter((item) => item.accountId === account.id);

  if (!force && (transactions.length || scheduled.length)) {
    throw conflict(
      `Account '${account.id}' still has ${transactions.length} transaction(s) and ${scheduled.length} scheduled item(s). ` +
        'Retry with ?force=true to delete them too, or PATCH archivedAt to keep the history.',
    );
  }

  for (const transaction of transactions) store.transactions.delete(transaction.id);
  for (const item of scheduled) store.scheduledItems.delete(item.id);
  store.accounts.delete(account.id);

  res.json({
    data: {
      deleted: { accounts: 1, transactions: transactions.length, scheduledItems: scheduled.length },
    },
  });
});

export default router;
