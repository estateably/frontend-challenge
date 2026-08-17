import { Router } from 'express';
import { z } from 'zod';
import { store, list, resetStore } from '../store/index.js';
import * as d from '../lib/dates.js';
import { parse } from '../lib/validate.js';

const router = Router();

/**
 * Test hooks. Nothing here is delayed or randomly failed by the simulate
 * middleware, so there is always a way to switch chaos back off.
 */

const counts = () => ({
  accounts: store.accounts.size,
  categories: store.categories.size,
  projects: store.projects.size,
  scheduledItems: store.scheduledItems.size,
  transactions: store.transactions.size,
});

/**
 * POST /api/dev/reset
 * Back to the seed. `scale` multiplies discretionary volume — scale=4 gives
 * roughly 5,000 transactions, which is where naive list rendering starts to hurt.
 */
router.post('/reset', (req, res) => {
  const body = parse(
    z
      .object({
        months: z.number().int().min(1).max(60).optional(),
        scale: z.number().min(0.1).max(10).optional(),
      })
      .strict(),
    req.body ?? {},
  );

  const meta = resetStore(body);
  res.json({ data: { ...meta, counts: counts() } });
});

router.get('/settings', (req, res) => {
  res.json({ data: store.settings });
});

/**
 * POST /api/dev/settings
 * Global latency and failure rate, for building loading and error states.
 *
 *   { "latencyMs": 800, "errorRate": 0.2 }   1 in 5 requests fails, all are slow
 *   { "latencyMs": 0, "errorRate": 0 }       back to normal
 *
 * Per-request overrides exist too: `x-simulate-latency` / `x-simulate-error`
 * headers, or `?__latency=` / `?__error=`.
 */
router.post('/settings', (req, res) => {
  const body = parse(
    z
      .object({
        latencyMs: z.number().int().min(0).max(30_000).optional(),
        errorRate: z.number().min(0).max(1).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, {
        message: 'Provide latencyMs and/or errorRate',
      }),
    req.body ?? {},
  );

  Object.assign(store.settings, body);
  res.json({ data: store.settings });
});

/** GET /api/dev/stats — row counts and the date span of the seeded ledger. */
router.get('/stats', (req, res) => {
  const transactions = list('transactions');
  const dates = transactions.map((transaction) => transaction.date).sort(d.cmp);

  res.json({
    data: {
      counts: counts(),
      seededAt: store.meta.seededAt,
      seedOptions: store.meta.options,
      today: d.today(),
      transactionDateRange: dates.length ? { first: dates[0], last: dates.at(-1) } : null,
      pending: transactions.filter((transaction) => transaction.status === 'pending').length,
      uncategorised: transactions.filter((transaction) => transaction.categoryId === null).length,
      transferLegs: transactions.filter((transaction) => transaction.transferId !== null).length,
      settings: store.settings,
    },
  });
});

export default router;
