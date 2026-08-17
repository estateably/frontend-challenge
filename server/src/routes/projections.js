import { Router } from 'express';
import { budgetProjection } from '../services/projections.js';
import { badRequest } from '../lib/errors.js';
import { BASE_CURRENCY, CURRENCIES } from '../lib/money.js';
import * as d from '../lib/dates.js';
import { GRANULARITIES, boolParam, dateParam, enumParam, listParam } from '../lib/validate.js';

const router = Router();

/**
 * GET /api/projections/budget
 * User story 4 — projected total balance over time.
 *
 * Defaults to today through six months out, bucketed by month. Actual
 * transactions cover dates up to `asOf` (default today) and scheduled items
 * cover everything after it, so nothing is counted twice. See
 * services/projections.js for the full set of assumptions — they also come back
 * in the response under `assumptions`.
 *
 *   includeCategoryBudgets=true  adds a crude discretionary-spend estimate from
 *                                the monthly category budgets. Off by default:
 *                                it is a guess, and the response labels it as one.
 *   asOf=YYYY-MM-DD              move the history/forecast seam, e.g. to check
 *                                what last month's projection would have said.
 */
router.get('/budget', (req, res) => {
  const from = dateParam(req.query.from, { name: 'from', fallback: d.today() });
  const to = dateParam(req.query.to, { name: 'to', fallback: d.endOfMonth(d.addMonths(from, 5)) });
  const asOf = dateParam(req.query.asOf, { name: 'asOf', fallback: d.today() });

  if (d.cmp(from, to) > 0) throw badRequest(`'from' (${from}) must not be after 'to' (${to})`);

  res.json(
    budgetProjection({
      from,
      to,
      asOf,
      granularity: enumParam(req.query.granularity, {
        name: 'granularity',
        allowed: GRANULARITIES,
        fallback: 'month',
      }),
      currency: enumParam(req.query.currency, {
        name: 'currency',
        allowed: Object.keys(CURRENCIES),
        fallback: BASE_CURRENCY,
      }),
      accountIds: listParam(req.query.accountId),
      includeScheduled: boolParam(req.query.includeScheduled, true),
      includeCategoryBudgets: boolParam(req.query.includeCategoryBudgets, false),
    }),
  );
});

export default router;
