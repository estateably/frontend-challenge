import { Router } from 'express';
import { categoryBreakdown, cashFlow, monthlyExpenses } from '../services/reports.js';
import { badRequest } from '../lib/errors.js';
import { BASE_CURRENCY, CURRENCIES } from '../lib/money.js';
import * as d from '../lib/dates.js';
import {
  GRANULARITIES,
  boolParam,
  dateParam,
  enumParam,
  listParam,
  monthParam,
} from '../lib/validate.js';

const router = Router();

/**
 * Every report takes a single `currency` (default CAD) and covers only the
 * accounts held in it. There are no exchange rates in this API, so a
 * cross-currency total would be fiction — the response echoes back its scope and
 * what it excluded so the client can say so out loud.
 */
function commonScope(query) {
  return {
    currency: enumParam(query.currency, {
      name: 'currency',
      allowed: Object.keys(CURRENCIES),
      fallback: BASE_CURRENCY,
    }),
    accountIds: listParam(query.accountId),
    projectIds: listParam(query.projectId),
    includePending: boolParam(query.includePending, true),
    includeTransfers: boolParam(query.includeTransfers, false),
  };
}

/**
 * GET /api/reports/monthly-expenses?from=2025-01&to=2025-06
 * User story 3 — expenses by category, month by month, with budget comparison.
 */
router.get('/monthly-expenses', (req, res) => {
  const to = monthParam(req.query.to, { name: 'to', fallback: d.monthKey(d.today()) });
  const from = monthParam(req.query.from, {
    name: 'from',
    fallback: d.monthKey(d.addMonths(d.monthStart(to), -5)),
  });

  if (from > to) throw badRequest(`'from' (${from}) must not be after 'to' (${to})`);

  res.json(monthlyExpenses({ from, to, ...commonScope(req.query) }));
});

/** GET /api/reports/category-breakdown?from=2025-01-01&to=2025-06-30 — one flat total per category. */
router.get('/category-breakdown', (req, res) => {
  const to = dateParam(req.query.to, { name: 'to', fallback: d.today() });
  const from = dateParam(req.query.from, { name: 'from', fallback: d.startOfMonth(to) });

  if (d.cmp(from, to) > 0) throw badRequest(`'from' (${from}) must not be after 'to' (${to})`);

  res.json(categoryBreakdown({ from, to, ...commonScope(req.query) }));
});

/** GET /api/reports/cash-flow?from&to&granularity=month — inflow vs outflow over time. */
router.get('/cash-flow', (req, res) => {
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

  if (d.cmp(from, to) > 0) throw badRequest(`'from' (${from}) must not be after 'to' (${to})`);

  res.json(cashFlow({ from, to, granularity, ...commonScope(req.query) }));
});

export default router;
