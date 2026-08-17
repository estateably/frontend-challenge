import { createRandom } from '../lib/random.js';
import { resetSeededIds, seededId } from '../lib/ids.js';
import * as d from '../lib/dates.js';
import { occurrenceDates } from '../services/recurrence.js';

/**
 * A plausible 18-month ledger for one household.
 *
 * Two properties matter more than realism:
 *
 * 1. It is *deterministic*. The PRNG is fixed-seed, so two runs on the same day
 *    produce byte-identical data — you can hard-code an id in a test.
 * 2. It is *anchored to today*. History ends today and scheduled items run into
 *    the future, so "this month" is always populated and projections always have
 *    something to project. Restarting tomorrow slides the window by a day.
 *
 * It also seeds the awkward cases on purpose — see EDGE CASES at the bottom.
 */

const ACCOUNTS = [
  {
    id: 'acc_chequing',
    name: 'Everyday Chequing',
    type: 'checking',
    institution: 'Banque Nationale',
    currency: 'CAD',
    openingBalance: 320_000,
    creditLimit: null,
    color: '#2563eb',
  },
  {
    id: 'acc_savings',
    name: 'Emergency Savings',
    type: 'savings',
    institution: 'Banque Nationale',
    currency: 'CAD',
    openingBalance: 4_200_000,
    creditLimit: null,
    color: '#0d9488',
  },
  {
    id: 'acc_visa',
    name: 'Travel Rewards Visa',
    type: 'credit_card',
    institution: 'Banque Nationale',
    currency: 'CAD',
    // Negative: a credit card balance is money owed, not money held.
    openingBalance: -84_300,
    creditLimit: 1_500_000,
    color: '#7c3aed',
  },
  {
    id: 'acc_cash',
    name: 'Cash Wallet',
    type: 'cash',
    institution: null,
    currency: 'CAD',
    openingBalance: 12_000,
    creditLimit: null,
    color: '#65a30d',
  },
  {
    id: 'acc_usd',
    name: 'USD Freelance Account',
    type: 'savings',
    institution: 'Wise',
    // A second currency, so totals can't be a single naive sum.
    currency: 'USD',
    openingBalance: 318_400,
    creditLimit: null,
    color: '#ea580c',
  },
];

/** `monthlyBudget` is in minor units and drives the budget-vs-actual reports. */
const CATEGORIES = [
  { id: 'cat_housing', name: 'Housing', kind: 'expense', parentId: null, monthlyBudget: null, color: '#334155' },
  { id: 'cat_rent', name: 'Rent', kind: 'expense', parentId: 'cat_housing', monthlyBudget: 215_000, color: '#475569' },
  { id: 'cat_utilities', name: 'Utilities', kind: 'expense', parentId: 'cat_housing', monthlyBudget: 18_000, color: '#64748b' },
  { id: 'cat_internet', name: 'Internet & Mobile', kind: 'expense', parentId: 'cat_housing', monthlyBudget: 16_000, color: '#94a3b8' },
  { id: 'cat_transport', name: 'Transport', kind: 'expense', parentId: null, monthlyBudget: null, color: '#1d4ed8' },
  { id: 'cat_fuel', name: 'Fuel', kind: 'expense', parentId: 'cat_transport', monthlyBudget: 20_000, color: '#2563eb' },
  { id: 'cat_transit', name: 'Transit', kind: 'expense', parentId: 'cat_transport', monthlyBudget: 16_000, color: '#3b82f6' },
  { id: 'cat_car', name: 'Car & Insurance', kind: 'expense', parentId: 'cat_transport', monthlyBudget: 15_000, color: '#60a5fa' },
  { id: 'cat_groceries', name: 'Groceries', kind: 'expense', parentId: null, monthlyBudget: 90_000, color: '#16a34a' },
  { id: 'cat_restaurants', name: 'Restaurants', kind: 'expense', parentId: null, monthlyBudget: 35_000, color: '#f59e0b' },
  { id: 'cat_coffee', name: 'Coffee', kind: 'expense', parentId: null, monthlyBudget: 8_000, color: '#b45309' },
  { id: 'cat_health', name: 'Health', kind: 'expense', parentId: null, monthlyBudget: 12_000, color: '#e11d48' },
  { id: 'cat_entertainment', name: 'Entertainment', kind: 'expense', parentId: null, monthlyBudget: 12_000, color: '#db2777' },
  { id: 'cat_subscriptions', name: 'Subscriptions', kind: 'expense', parentId: null, monthlyBudget: 8_000, color: '#9333ea' },
  { id: 'cat_shopping', name: 'Shopping', kind: 'expense', parentId: null, monthlyBudget: 25_000, color: '#0891b2' },
  { id: 'cat_travel', name: 'Travel', kind: 'expense', parentId: null, monthlyBudget: 30_000, color: '#0284c7' },
  { id: 'cat_home_improvement', name: 'Home Improvement', kind: 'expense', parentId: null, monthlyBudget: 200_000, color: '#78716c' },
  { id: 'cat_gifts', name: 'Gifts & Donations', kind: 'expense', parentId: null, monthlyBudget: 10_000, color: '#c026d3' },
  { id: 'cat_fees', name: 'Bank Fees', kind: 'expense', parentId: null, monthlyBudget: 2_000, color: '#a16207' },
  { id: 'cat_other', name: 'Other', kind: 'expense', parentId: null, monthlyBudget: null, color: '#71717a' },
  { id: 'cat_salary', name: 'Salary', kind: 'income', parentId: null, monthlyBudget: null, color: '#15803d' },
  { id: 'cat_freelance', name: 'Freelance', kind: 'income', parentId: null, monthlyBudget: null, color: '#4d7c0f' },
  { id: 'cat_interest', name: 'Interest', kind: 'income', parentId: null, monthlyBudget: null, color: '#0f766e' },
  { id: 'cat_refunds', name: 'Refunds', kind: 'income', parentId: null, monthlyBudget: null, color: '#7e22ce' },
];

const MERCHANTS = {
  cat_groceries: ['Metro Plus', 'IGA Extra', 'Provigo', 'Marché Jean-Talon', 'Costco Wholesale'],
  cat_restaurants: ['Schwartz’s Deli', 'Pho Tay Ho', 'Le Petit Coin', 'Damas', 'Tacos Frida'],
  cat_coffee: ['Café Olimpico', 'Dispatch Coffee', 'Tim Hortons', 'Pikolo Espresso'],
  cat_fuel: ['Petro-Canada', 'Esso', 'Shell', 'Costco Gas'],
  cat_transit: ['STM Opus', 'BIXI Montréal', 'Communauto', 'Via Rail'],
  cat_health: ['Jean Coutu', 'Clinique Dentaire Rosemont', 'Physio Plateau', 'Uniprix'],
  cat_entertainment: ['Cinéma Beaubien', 'La Tulipe', 'Steam', 'Théâtre Outremont'],
  cat_subscriptions: ['Spotify', 'iCloud+', 'Figma', 'New York Times'],
  cat_shopping: ['Simons', 'Amazon.ca', 'MEC', 'Renaud-Bray', 'Uniqlo'],
  cat_travel: ['Air Canada', 'Airbnb', 'VIA Rail', 'Hotel Nelligan'],
  cat_home_improvement: ['Rona', 'Home Depot', 'Bétonel', 'Plancher Décor', 'Plomberie Lavoie'],
  cat_gifts: ['Fondation CHU', 'Etsy', 'Fleuriste Cartier'],
  cat_fees: ['Monthly account fee', 'ATM withdrawal fee', 'Foreign exchange fee'],
  cat_other: ['Sundry purchase', 'Unlabelled debit'],
};

/**
 * Discretionary spending profiles. `perMonth` is a range, so month-to-month
 * totals move around and reports have something to show.
 */
const SPENDING = [
  { categoryId: 'cat_groceries', accounts: ['acc_chequing', 'acc_visa'], perMonth: [6, 10], min: 2_500, max: 16_000 },
  { categoryId: 'cat_restaurants', accounts: ['acc_visa', 'acc_chequing'], perMonth: [3, 8], min: 1_800, max: 9_500 },
  { categoryId: 'cat_coffee', accounts: ['acc_visa', 'acc_cash'], perMonth: [4, 12], min: 375, max: 1_450 },
  { categoryId: 'cat_fuel', accounts: ['acc_visa'], perMonth: [1, 3], min: 4_200, max: 9_800 },
  { categoryId: 'cat_transit', accounts: ['acc_chequing', 'acc_cash'], perMonth: [1, 4], min: 350, max: 15_600 },
  { categoryId: 'cat_shopping', accounts: ['acc_visa'], perMonth: [1, 4], min: 2_000, max: 24_000 },
  { categoryId: 'cat_entertainment', accounts: ['acc_visa'], perMonth: [1, 3], min: 1_200, max: 8_500 },
  { categoryId: 'cat_subscriptions', accounts: ['acc_visa'], perMonth: [2, 3], min: 599, max: 2_400 },
  { categoryId: 'cat_health', accounts: ['acc_chequing'], perMonth: [0, 2], min: 2_000, max: 18_000 },
  { categoryId: 'cat_gifts', accounts: ['acc_visa'], perMonth: [0, 1], min: 2_500, max: 12_000 },
  { categoryId: 'cat_fees', accounts: ['acc_chequing'], perMonth: [0, 1], min: 195, max: 1_600 },
];

/**
 * Recurring money. These become BOTH the historical transactions and the
 * scheduled items used for projection, so past and future agree with each other.
 * `jitter` makes the posted amount wobble around the scheduled amount — variable
 * bills are the norm, and it keeps "projected vs. actual" interesting.
 */
const RECURRING = [
  { id: 'sch_rent', name: 'Rent — 2140 Rue Beaubien', kind: 'bill', accountId: 'acc_chequing', categoryId: 'cat_rent', amount: -215_000, frequency: 'monthly', day: 1, autoPay: true, jitter: 0 },
  { id: 'sch_salary', name: 'Salary — Northwind Studio', kind: 'income', accountId: 'acc_chequing', categoryId: 'cat_salary', amount: 218_400, frequency: 'biweekly', day: null, autoPay: true, jitter: 0 },
  { id: 'sch_hydro', name: 'Hydro-Québec', kind: 'bill', accountId: 'acc_chequing', categoryId: 'cat_utilities', amount: -11_500, frequency: 'monthly', day: 15, autoPay: true, jitter: 6_500 },
  { id: 'sch_internet', name: 'Videotron Internet', kind: 'bill', accountId: 'acc_chequing', categoryId: 'cat_internet', amount: -8_495, frequency: 'monthly', day: 5, autoPay: true, jitter: 0 },
  { id: 'sch_mobile', name: 'Fizz Mobile', kind: 'bill', accountId: 'acc_visa', categoryId: 'cat_internet', amount: -4_600, frequency: 'monthly', day: 8, autoPay: true, jitter: 0 },
  { id: 'sch_netflix', name: 'Netflix', kind: 'bill', accountId: 'acc_visa', categoryId: 'cat_subscriptions', amount: -1_699, frequency: 'monthly', day: 20, autoPay: true, jitter: 0 },
  { id: 'sch_gym', name: 'Gym membership', kind: 'bill', accountId: 'acc_visa', categoryId: 'cat_health', amount: -4_500, frequency: 'monthly', day: 1, autoPay: true, jitter: 0 },
  { id: 'sch_car_insurance', name: 'Car insurance — Desjardins', kind: 'bill', accountId: 'acc_chequing', categoryId: 'cat_car', amount: -14_200, frequency: 'monthly', day: 12, autoPay: true, jitter: 0 },
  // Deliberately lands on the 31st: it must clamp to Feb 28/29 and spring back.
  { id: 'sch_water', name: 'Water & sewer', kind: 'bill', accountId: 'acc_chequing', categoryId: 'cat_utilities', amount: -9_800, frequency: 'quarterly', day: 31, autoPay: false, jitter: 1_200 },
  { id: 'sch_domain', name: 'Domain & hosting renewal', kind: 'bill', accountId: 'acc_visa', categoryId: 'cat_subscriptions', amount: -18_900, frequency: 'yearly', day: 22, autoPay: true, jitter: 0 },
  { id: 'sch_freelance', name: 'Freelance retainer — Atelier Kova', kind: 'income', accountId: 'acc_chequing', categoryId: 'cat_freelance', amount: 90_000, frequency: 'monthly', day: 25, autoPay: false, jitter: 45_000 },
  { id: 'sch_usd_client', name: 'US client invoice', kind: 'income', accountId: 'acc_usd', categoryId: 'cat_freelance', amount: 150_000, frequency: 'quarterly', day: 10, autoPay: false, jitter: 60_000 },
  { id: 'sch_interest', name: 'Savings interest', kind: 'income', accountId: 'acc_savings', categoryId: 'cat_interest', amount: 1_850, frequency: 'monthly', day: 28, autoPay: true, jitter: 400 },
];

export function buildSeed({ months = 18, scale = 1 } = {}) {
  const anchor = d.today();
  const historyStart = d.startOfMonth(d.addMonths(anchor, -(months - 1)));
  const rng = createRandom(0xc0ffee);

  resetSeededIds();

  const accounts = ACCOUNTS.map((account) => ({
    ...account,
    openedAt: d.addDays(historyStart, -1),
    archivedAt: null,
    createdAt: `${d.addDays(historyStart, -1)}T09:00:00.000Z`,
    updatedAt: `${d.addDays(historyStart, -1)}T09:00:00.000Z`,
  }));

  const categories = CATEGORIES.map((category) => ({
    ...category,
    archivedAt: null,
    createdAt: `${d.addDays(historyStart, -1)}T09:00:00.000Z`,
    updatedAt: `${d.addDays(historyStart, -1)}T09:00:00.000Z`,
  }));

  const projects = buildProjects(anchor);
  const scheduledItems = buildScheduledItems(anchor, historyStart, projects);

  // Collect raw events first, then sort by date before assigning ids, so
  // txn_00001 is the oldest row in the ledger.
  const events = [];
  const push = (event) => {
    if (d.cmp(event.date, historyStart) >= 0 && d.cmp(event.date, anchor) <= 0) events.push(event);
  };

  addRecurringHistory({ push, rng, scheduledItems, anchor });
  addDiscretionarySpending({ push, rng, anchor, historyStart, scale });
  addCashSpending({ push, rng, anchor, historyStart });
  addUsdActivity({ push, rng, anchor, historyStart });
  addProjectSpending({ push, rng, anchor, projects });
  addEdgeCases({ push, anchor });
  // Last, because transfers react to the spending above: the card payment clears
  // the previous statement and the remodel is funded out of savings.
  addTransfers({ push, rng, anchor, historyStart, events });

  const transactions = events
    .sort((a, b) => d.cmp(a.date, b.date) || a.description.localeCompare(b.description))
    .map((event) => materialise(event, rng, anchor));

  return {
    accounts,
    categories,
    projects,
    scheduledItems,
    transactions,
    options: {
      months,
      scale,
      anchorDate: anchor,
      historyStart,
      transactionCount: transactions.length,
    },
  };
}

/** Turns a raw event into a stored transaction. */
function materialise(event, rng, anchor) {
  const daysAgo = d.diffDays(event.date, anchor);
  // A card swipe from three days ago may still be pending; older rows are settled.
  const pending = event.status === 'pending' || (daysAgo <= 3 && event.pendable && rng.chance(0.45));
  const hour = String(rng.int(7, 21)).padStart(2, '0');
  const minute = String(rng.int(0, 59)).padStart(2, '0');
  const timestamp = `${event.date}T${hour}:${minute}:00.000Z`;

  return {
    id: seededId('txn'),
    accountId: event.accountId,
    date: event.date,
    amount: event.amount,
    currency: event.currency,
    description: event.description,
    merchant: event.merchant ?? null,
    categoryId: event.categoryId ?? null,
    projectId: event.projectId ?? null,
    status: pending ? 'pending' : 'posted',
    transferId: event.transferId ?? null,
    scheduledItemId: event.scheduledItemId ?? null,
    notes: event.notes ?? null,
    tags: event.tags ?? [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function buildProjects(anchor) {
  const stamp = (date) => `${date}T09:00:00.000Z`;
  const remodelStart = d.startOfMonth(d.addMonths(anchor, -5));
  const franceStart = d.startOfMonth(d.addMonths(anchor, 1));
  const officeStart = d.startOfMonth(d.addMonths(anchor, -11));

  return [
    {
      id: 'proj_remodel',
      name: 'Kitchen remodel',
      description: 'Cabinets, counters, plumbing and paint for the kitchen.',
      status: 'active',
      currency: 'CAD',
      // Sized so the project is close to budget on spend, but goes over once the
      // contractor's final payment is committed — the state worth designing for.
      budget: 3_400_000,
      startDate: remodelStart,
      endDate: d.endOfMonth(d.addMonths(anchor, 2)),
      color: '#78716c',
      createdAt: stamp(remodelStart),
      updatedAt: stamp(remodelStart),
    },
    {
      id: 'proj_france',
      name: 'Trip to France',
      description: 'Two weeks in Paris and Lyon. Mostly still ahead of us.',
      status: 'planned',
      currency: 'CAD',
      budget: 800_000,
      startDate: franceStart,
      endDate: d.endOfMonth(d.addMonths(anchor, 2)),
      color: '#0284c7',
      createdAt: stamp(d.addMonths(anchor, -2)),
      updatedAt: stamp(d.addMonths(anchor, -1)),
    },
    {
      id: 'proj_office',
      name: 'Home office setup',
      description: 'Desk, chair and monitor. Finished and under budget.',
      status: 'completed',
      currency: 'CAD',
      budget: 350_000,
      startDate: officeStart,
      endDate: d.endOfMonth(d.addMonths(anchor, -9)),
      color: '#0891b2',
      createdAt: stamp(officeStart),
      updatedAt: stamp(d.endOfMonth(d.addMonths(anchor, -9))),
    },
  ];
}

function buildScheduledItems(anchor, historyStart, projects) {
  const stamp = `${historyStart}T09:00:00.000Z`;
  const currencyOf = (accountId) =>
    ACCOUNTS.find((account) => account.id === accountId)?.currency ?? 'CAD';

  // Salary is biweekly: anchor it to the first Friday inside the window.
  const firstFriday = (() => {
    let date = historyStart;
    while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 5) date = d.addDays(date, 1);
    return date;
  })();

  const recurring = RECURRING.map((item) => ({
    id: item.id,
    name: item.name,
    kind: item.kind,
    accountId: item.accountId,
    categoryId: item.categoryId,
    projectId: null,
    amount: item.amount,
    currency: currencyOf(item.accountId),
    frequency: item.frequency,
    startDate: item.frequency === 'biweekly' ? firstFriday : d.withDay(historyStart, item.day),
    endDate: null,
    autoPay: item.autoPay,
    status: 'active',
    notes: null,
    variance: item.jitter,
    skippedDates: [],
    postedOccurrences: [],
    createdAt: stamp,
    updatedAt: stamp,
  }));

  const france = projects.find((project) => project.id === 'proj_france');
  const remodel = projects.find((project) => project.id === 'proj_remodel');

  // One-off future items: nothing in history matches these, so they only ever
  // show up in the upcoming list and the projection.
  const oneOffs = [
    {
      id: 'sch_flights_paris',
      name: 'Flights to Paris (2 adults)',
      kind: 'bill',
      accountId: 'acc_visa',
      categoryId: 'cat_travel',
      projectId: france.id,
      amount: -184_000,
      frequency: 'once',
      startDate: d.addDays(anchor, 26),
      autoPay: false,
      status: 'active',
      notes: 'Booked but not charged until 30 days before departure.',
    },
    {
      id: 'sch_paris_apartment',
      name: 'Paris apartment — balance due',
      kind: 'bill',
      accountId: 'acc_chequing',
      categoryId: 'cat_travel',
      projectId: france.id,
      amount: -96_500,
      frequency: 'once',
      startDate: d.addDays(anchor, 48),
      autoPay: false,
      status: 'active',
      notes: null,
    },
    {
      id: 'sch_contractor_final',
      name: 'Contractor — final payment',
      kind: 'bill',
      accountId: 'acc_chequing',
      categoryId: 'cat_home_improvement',
      projectId: remodel.id,
      amount: -455_000,
      frequency: 'once',
      startDate: d.addDays(anchor, 17),
      autoPay: false,
      status: 'active',
      notes: 'Due on completion of the counter install.',
    },
    {
      id: 'sch_tax_refund',
      name: 'Tax refund',
      kind: 'income',
      accountId: 'acc_chequing',
      categoryId: 'cat_refunds',
      projectId: null,
      amount: 128_400,
      frequency: 'once',
      startDate: d.addDays(anchor, 33),
      autoPay: false,
      status: 'active',
      notes: 'Assessed, payment date estimated.',
    },
    {
      id: 'sch_meal_kit',
      name: 'Meal kit subscription',
      kind: 'bill',
      accountId: 'acc_visa',
      categoryId: 'cat_groceries',
      projectId: null,
      amount: -6_400,
      frequency: 'monthly',
      startDate: d.withDay(anchor, 14),
      // Paused: it must be excluded from projections until resumed.
      status: 'paused',
      autoPay: true,
      notes: 'Paused while the kitchen is torn up.',
    },
  ].map((item) => ({
    ...item,
    currency: currencyOf(item.accountId),
    endDate: null,
    variance: 0,
    skippedDates: [],
    postedOccurrences: [],
    createdAt: `${d.addDays(anchor, -20)}T09:00:00.000Z`,
    updatedAt: `${d.addDays(anchor, -20)}T09:00:00.000Z`,
  }));

  return [...recurring, ...oneOffs];
}

function addRecurringHistory({ push, rng, scheduledItems, anchor }) {
  for (const item of scheduledItems) {
    if (item.status !== 'active' || item.frequency === 'once') continue;

    for (const date of occurrenceDates(item, item.startDate, anchor)) {
      const wobble = item.variance ? rng.int(-item.variance, item.variance) : 0;
      const amount = item.amount + (item.amount < 0 ? -Math.abs(wobble) : Math.abs(wobble));

      push({
        accountId: item.accountId,
        date,
        amount,
        currency: item.currency,
        description: item.name,
        merchant: item.name.split(' — ')[0],
        categoryId: item.categoryId,
        scheduledItemId: item.id,
        pendable: false,
      });
    }
  }
}

/**
 * The last day of a month worth generating on: today, for the month in progress.
 * Without this the current month would only ever be populated by luck, and any
 * "this month" screen would sometimes open empty.
 */
function spendableDays(monthKey, anchor) {
  const days = d.daysInMonth(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)));
  return monthKey === d.monthKey(anchor) ? Math.min(days, d.dayOfMonth(anchor)) : days;
}

function addDiscretionarySpending({ push, rng, anchor, historyStart, scale }) {
  for (let month = historyStart; d.cmp(month, anchor) <= 0; month = d.addMonths(month, 1)) {
    const key = d.monthKey(month);
    const days = spendableDays(key, anchor);

    for (const profile of SPENDING) {
      const count = Math.round(rng.int(profile.perMonth[0], profile.perMonth[1]) * scale);

      for (let i = 0; i < count; i += 1) {
        const merchant = rng.pick(MERCHANTS[profile.categoryId] ?? MERCHANTS.cat_other);
        const accountId = rng.pick(profile.accounts);
        const magnitude = rng.amount(profile.min, profile.max);
        // ~2% of rows arrive with no category: a "needs review" queue to build UI for.
        const uncategorised = rng.chance(0.02);
        // ~2% are refunds — a positive amount inside an expense category, which
        // is why reports must net rather than assume sign by category.
        const refund = rng.chance(0.02);

        push({
          accountId,
          date: `${key}-${String(rng.int(1, days)).padStart(2, '0')}`,
          amount: refund ? magnitude : -magnitude,
          currency: 'CAD',
          description: refund ? `Refund — ${merchant}` : merchant,
          merchant,
          categoryId: uncategorised ? null : refund ? 'cat_refunds' : profile.categoryId,
          pendable: true,
        });
      }
    }
  }
}

function addCashSpending({ push, rng, anchor, historyStart }) {
  for (let month = historyStart; d.cmp(month, anchor) <= 0; month = d.addMonths(month, 1)) {
    const key = d.monthKey(month);
    const days = spendableDays(key, anchor);

    for (let i = 0; i < rng.int(2, 5); i += 1) {
      push({
        accountId: 'acc_cash',
        date: `${key}-${String(rng.int(1, days)).padStart(2, '0')}`,
        amount: -rng.amount(300, 4_000),
        currency: 'CAD',
        description: rng.pick(['Marché Jean-Talon', 'Dépanneur', 'Bakery', 'Farmers market']),
        merchant: null,
        categoryId: rng.pick(['cat_groceries', 'cat_coffee', 'cat_other']),
        pendable: false,
      });
    }
  }
}

/**
 * Transfers between the household's own accounts. Each one exists so a balance
 * stays believable: the card gets paid off, the wallet gets refilled, and the
 * remodel is funded from savings rather than magically from a chequing account
 * that would otherwise go deep into overdraft.
 */
/**
 * The USD account earns in USD (quarterly client invoices, from RECURRING) and
 * spends in USD. Every month has activity in both currencies, so any code that
 * quietly adds CAD to USD produces an obviously wrong number rather than a
 * plausible one.
 */
function addUsdActivity({ push, rng, anchor, historyStart }) {
  const tools = ['Adobe Creative Cloud', 'Vercel', 'AWS', 'Linear', 'Notion', 'GitHub'];

  for (let month = historyStart; d.cmp(month, anchor) <= 0; month = d.addMonths(month, 1)) {
    const key = d.monthKey(month);
    const days = spendableDays(key, anchor);

    for (let i = 0; i < rng.int(2, 4); i += 1) {
      const merchant = rng.pick(tools);
      push({
        accountId: 'acc_usd',
        date: `${key}-${String(rng.int(1, days)).padStart(2, '0')}`,
        amount: -rng.amount(900, 12_000),
        currency: 'USD',
        description: merchant,
        merchant,
        categoryId: 'cat_subscriptions',
        pendable: false,
      });
    }
  }
}

function addTransfers({ push, rng, anchor, historyStart, events }) {
  let sequence = 0;
  const transferId = () => `tfr_${String((sequence += 1)).padStart(5, '0')}`;

  const pair = ({ from, to, date, amount, out, into }) => {
    if (amount <= 0) return;
    const transfer = transferId();
    push({ accountId: from, date, amount: -amount, currency: 'CAD', description: out, categoryId: null, transferId: transfer, pendable: false });
    push({ accountId: to, date, amount, currency: 'CAD', description: into, categoryId: null, transferId: transfer, pendable: false });
  };

  /** Net spend on an account within a month, ignoring transfers already recorded. */
  const netSpend = (accountId, month, predicate = () => true) => {
    const total = events
      .filter(
        (event) =>
          event.accountId === accountId &&
          !event.transferId &&
          d.monthKey(event.date) === month &&
          predicate(event),
      )
      .reduce((sum, event) => sum + event.amount, 0);
    return Math.max(0, -total);
  };

  for (let month = historyStart; d.cmp(month, anchor) <= 0; month = d.addMonths(month, 1)) {
    const key = d.monthKey(month);
    const previous = d.monthKey(d.addMonths(month, -1));

    // Regular saving, on payday-ish. Sized to absorb most of the monthly surplus.
    pair({
      from: 'acc_chequing',
      to: 'acc_savings',
      date: d.withDay(month, 2),
      amount: rng.amount(70_000, 110_000),
      out: 'Transfer to Emergency Savings',
      into: 'Transfer from Everyday Chequing',
    });

    // Statement paid in full: whatever went on the card last month.
    pair({
      from: 'acc_chequing',
      to: 'acc_visa',
      date: d.withDay(month, 18),
      amount: netSpend('acc_visa', previous),
      out: 'Visa payment',
      into: 'Payment received — thank you',
    });

    // Cash top-up, sized to what the wallet actually spent last month plus a
    // little slack, so it never funds spending it doesn't have.
    pair({
      from: 'acc_chequing',
      to: 'acc_cash',
      date: d.withDay(month, 6),
      amount: Math.max(6_000, Math.ceil((netSpend('acc_cash', previous) + rng.amount(4_000, 10_000)) / 2_000) * 2_000),
      out: 'ATM withdrawal',
      into: 'ATM withdrawal',
    });

    // Reno draw: the remodel is paid for out of the savings earmarked for it.
    const isRemodel = (event) => event.projectId === 'proj_remodel';
    const remodelSpend =
      netSpend('acc_chequing', key, isRemodel) + netSpend('acc_visa', previous, isRemodel);
    pair({
      from: 'acc_savings',
      to: 'acc_chequing',
      date: d.withDay(month, 3),
      amount: remodelSpend,
      out: 'Transfer to Everyday Chequing (kitchen remodel)',
      into: 'Transfer from Emergency Savings (kitchen remodel)',
    });
  }
}

function addProjectSpending({ push, rng, anchor, projects }) {
  const remodel = projects.find((project) => project.id === 'proj_remodel');
  const office = projects.find((project) => project.id === 'proj_office');
  const france = projects.find((project) => project.id === 'proj_france');

  for (let month = remodel.startDate; d.cmp(month, anchor) <= 0; month = d.addMonths(month, 1)) {
    const key = d.monthKey(month);
    const days = spendableDays(key, anchor);

    for (let i = 0; i < rng.int(2, 4); i += 1) {
      const merchant = rng.pick(MERCHANTS.cat_home_improvement);
      push({
        accountId: rng.chance(0.7) ? 'acc_chequing' : 'acc_visa',
        date: `${key}-${String(rng.int(1, days)).padStart(2, '0')}`,
        amount: -rng.amount(12_000, 320_000),
        currency: 'CAD',
        description: merchant,
        merchant,
        categoryId: 'cat_home_improvement',
        projectId: remodel.id,
        tags: ['remodel'],
        pendable: true,
      });
    }
  }

  for (let i = 0; i < 4; i += 1) {
    const merchant = rng.pick(MERCHANTS.cat_shopping);
    push({
      accountId: 'acc_visa',
      date: d.addDays(office.startDate, rng.int(0, 40)),
      amount: -rng.amount(18_000, 120_000),
      currency: 'CAD',
      description: merchant,
      merchant,
      categoryId: 'cat_shopping',
      projectId: office.id,
      pendable: false,
    });
  }

  // A planned project can still have sunk cost: deposits paid before it starts.
  push({
    accountId: 'acc_visa',
    date: d.addDays(anchor, -46),
    amount: -42_500,
    currency: 'CAD',
    description: 'Airbnb — Lyon deposit',
    merchant: 'Airbnb',
    categoryId: 'cat_travel',
    projectId: france.id,
    pendable: false,
  });
  push({
    accountId: 'acc_visa',
    date: d.addDays(anchor, -12),
    amount: -18_900,
    currency: 'CAD',
    description: 'Passport renewal',
    merchant: 'Service Canada',
    categoryId: 'cat_travel',
    projectId: france.id,
    pendable: false,
  });
}

/**
 * EDGE CASES — seeded on purpose. Every one of these has broken a real finance UI:
 *
 * - two transactions straddling a month boundary at the extremes of the day, so
 *   any accidental UTC/local conversion moves them into the wrong month report
 * - an exact duplicate pair (same day, merchant and amount) that is *not* an error
 * - a zero-amount row (a corrected pre-authorisation)
 * - a very large amount, to break naive column widths and integer assumptions
 * - a hotel pre-authorisation that is pending and may never post, so "balance"
 *   has to mean either posted-only or including-pending, and you have to pick
 * - a transaction with no category and no merchant
 */
function addEdgeCases({ push, anchor }) {
  const lastMonthEnd = d.endOfMonth(d.addMonths(d.startOfMonth(anchor), -1));
  const thisMonthStart = d.startOfMonth(anchor);

  push({ accountId: 'acc_visa', date: lastMonthEnd, amount: -3_150, currency: 'CAD', description: 'Late-night dépanneur run', merchant: 'Dépanneur du Coin', categoryId: 'cat_groceries', notes: 'Posted 23:58 local on the last day of the month.', pendable: false });
  push({ accountId: 'acc_visa', date: thisMonthStart, amount: -2_400, currency: 'CAD', description: 'Early-morning croissants', merchant: 'Boulangerie Guillaume', categoryId: 'cat_coffee', notes: 'Posted 00:12 local on the first day of the month.', pendable: false });

  push({ accountId: 'acc_visa', date: d.addDays(anchor, -9), amount: -1_499, currency: 'CAD', description: 'Café Olimpico', merchant: 'Café Olimpico', categoryId: 'cat_coffee', notes: 'Genuine duplicate — two rounds, two taps.', pendable: false });
  push({ accountId: 'acc_visa', date: d.addDays(anchor, -9), amount: -1_499, currency: 'CAD', description: 'Café Olimpico', merchant: 'Café Olimpico', categoryId: 'cat_coffee', notes: 'Genuine duplicate — two rounds, two taps.', pendable: false });

  push({ accountId: 'acc_chequing', date: d.addDays(anchor, -6), amount: 0, currency: 'CAD', description: 'Pre-authorisation reversal', merchant: 'Petro-Canada', categoryId: 'cat_fuel', notes: 'Zero-amount correction.', pendable: false });

  push({ accountId: 'acc_savings', date: d.addDays(anchor, -21), amount: 1_850_000, currency: 'CAD', description: 'RRSP transfer in', merchant: null, categoryId: 'cat_other', notes: 'Large amount, on purpose.', pendable: false });

  push({ accountId: 'acc_visa', date: d.addDays(anchor, -2), amount: -74_500, currency: 'CAD', description: 'Hotel Nelligan pre-authorisation', merchant: 'Hotel Nelligan', categoryId: 'cat_travel', status: 'pending', pendable: false });

  push({ accountId: 'acc_chequing', date: d.addDays(anchor, -4), amount: -6_782, currency: 'CAD', description: 'POS PURCHASE 8841', merchant: null, categoryId: null, pendable: false });
}
