import { Router } from 'express';
import accounts from './accounts.js';
import transactions from './transactions.js';
import transfers from './transfers.js';
import categories from './categories.js';
import projects from './projects.js';
import scheduledItems from './scheduled-items.js';
import reports from './reports.js';
import projections from './projections.js';
import dev from './dev.js';
import { store } from '../store/index.js';
import { CURRENCIES, BASE_CURRENCY } from '../lib/money.js';
import * as d from '../lib/dates.js';
import {
  ACCOUNT_TYPES,
  CATEGORY_KINDS,
  FREQUENCIES,
  GRANULARITIES,
  PROJECT_STATUSES,
  SCHEDULED_KINDS,
  TRANSACTION_STATUSES,
} from '../lib/validate.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../lib/paginate.js';

const router = Router();

/** GET /api/health — liveness, plus how much data is loaded. */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    today: d.today(),
    serverTime: d.nowIso(),
    seededAt: store.meta.seededAt,
    transactionCount: store.transactions.size,
  });
});

/**
 * GET /api/meta
 * Every enum the API accepts, plus the conventions the client has to honour.
 * Fetch it once at boot instead of hard-coding string unions in two places.
 */
router.get('/meta', (req, res) => {
  res.json({
    data: {
      conventions: {
        money:
          'All amounts are integers in minor units (cents). Decimals are rejected with 422. Negative = money out, positive = money in.',
        balances:
          'A negative balance means overdrawn, or money owed on a credit card. Credit limits are positive; availableCredit = creditLimit + balance.',
        dates:
          'Calendar dates are YYYY-MM-DD strings with no timezone — a transaction happens on a day. createdAt/updatedAt are ISO-8601 UTC instants.',
        transfers:
          'A transfer is two transactions sharing a transferId. Reports exclude transfer legs by default so money moved between your own accounts is not counted as income or expense.',
        reports:
          'outflow and inflow are magnitudes (always >= 0); net = inflow - outflow. Classification follows the sign of the amount, not the category kind, so a refund counts as inflow.',
        pagination: `page/pageSize or offset/limit. Default pageSize ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}. Sort with sort=-date,amount ('-' prefix = descending).`,
        currency:
          'Accounts have a currency and there are no exchange rates. Reports and projections cover one currency at a time; totals are grouped by currency, never summed across them.',
      },
      currencies: Object.values(CURRENCIES),
      baseCurrency: BASE_CURRENCY,
      enums: {
        accountType: ACCOUNT_TYPES,
        transactionStatus: TRANSACTION_STATUSES,
        categoryKind: CATEGORY_KINDS,
        scheduledItemKind: SCHEDULED_KINDS,
        scheduledItemStatus: ['active', 'paused'],
        occurrenceStatus: ['posted', 'skipped', 'overdue', 'scheduled'],
        frequency: FREQUENCIES,
        projectStatus: PROJECT_STATUSES,
        granularity: GRANULARITIES,
        direction: ['inflow', 'outflow'],
      },
      limits: { defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE, maxBulkSize: 1000 },
      today: d.today(),
    },
  });
});

/** GET /api — the endpoint index, so the API is explorable without the README. */
router.get('/', (req, res) => {
  res.json({
    name: 'Personal Finance Manager API',
    description: 'In-memory backend for the frontend technical challenge. Data resets on restart.',
    docs: 'See docs/API.md in the repository for the full contract.',
    endpoints: {
      meta: ['GET /api/health', 'GET /api/meta'],
      accounts: [
        'GET /api/accounts',
        'POST /api/accounts',
        'GET /api/accounts/balances',
        'GET /api/accounts/:id',
        'PATCH /api/accounts/:id',
        'DELETE /api/accounts/:id',
        'GET /api/accounts/:id/balance',
        'GET /api/accounts/:id/balance-history',
      ],
      transactions: [
        'GET /api/transactions',
        'POST /api/transactions',
        'POST /api/transactions/bulk',
        'POST /api/transactions/bulk-update',
        'GET /api/transactions/:id',
        'PATCH /api/transactions/:id',
        'DELETE /api/transactions/:id',
      ],
      transfers: [
        'GET /api/transfers',
        'POST /api/transfers',
        'GET /api/transfers/:transferId',
        'DELETE /api/transfers/:transferId',
      ],
      categories: [
        'GET /api/categories',
        'POST /api/categories',
        'GET /api/categories/:id',
        'PATCH /api/categories/:id',
        'DELETE /api/categories/:id',
      ],
      projects: [
        'GET /api/projects',
        'POST /api/projects',
        'GET /api/projects/:id',
        'GET /api/projects/:id/summary',
        'PATCH /api/projects/:id',
        'DELETE /api/projects/:id',
      ],
      scheduledItems: [
        'GET /api/scheduled-items',
        'POST /api/scheduled-items',
        'GET /api/scheduled-items/occurrences',
        'GET /api/scheduled-items/:id',
        'GET /api/scheduled-items/:id/occurrences',
        'PATCH /api/scheduled-items/:id',
        'DELETE /api/scheduled-items/:id',
        'POST /api/scheduled-items/:id/post',
        'POST /api/scheduled-items/:id/skip',
        'POST /api/scheduled-items/:id/unskip',
      ],
      reports: [
        'GET /api/reports/monthly-expenses',
        'GET /api/reports/category-breakdown',
        'GET /api/reports/cash-flow',
      ],
      projections: ['GET /api/projections/budget'],
      dev: [
        'POST /api/dev/reset',
        'GET /api/dev/settings',
        'POST /api/dev/settings',
        'GET /api/dev/stats',
      ],
    },
    userStories: {
      1: 'Accounts and their transactions — /api/accounts, /api/transactions, /api/transfers',
      2: 'Balance now or as of any date — /api/accounts/balances?asOf=, /api/accounts/:id/balance-history',
      3: 'Expenses by category per month — /api/reports/monthly-expenses',
      4: 'Future bills and budget projection — /api/scheduled-items, /api/projections/budget',
      5: 'Project spending — /api/projects/:id/summary',
    },
  });
});

router.use('/accounts', accounts);
router.use('/transactions', transactions);
router.use('/transfers', transfers);
router.use('/categories', categories);
router.use('/projects', projects);
router.use('/scheduled-items', scheduledItems);
router.use('/reports', reports);
router.use('/projections', projections);
router.use('/dev', dev);

export default router;
