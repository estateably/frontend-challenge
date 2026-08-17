/**
 * Type definitions for the Personal Finance Manager API.
 *
 * Copy this file into your client (or import it from here) so the data contract
 * lives in one place. It is hand-written to match the server, not generated — if
 * you find a mismatch, the server is the source of truth and the mismatch is
 * worth mentioning in the discussion.
 *
 * Two conventions run through everything:
 *
 *   Minor  an integer number of minor units (cents). -4599 is -$45.99.
 *          Never a float. Negative = money out, positive = money in.
 *   IsoDate a calendar date, 'YYYY-MM-DD'. No time, no timezone.
 */

/** Integer minor units (cents). Negative = outflow, positive = inflow. */
export type Minor = number;

/** Calendar date, `YYYY-MM-DD`. Deliberately not a timestamp. */
export type IsoDate = string;

/** Month, `YYYY-MM`. */
export type IsoMonth = string;

/** ISO-8601 UTC instant, e.g. `2025-06-14T18:22:05.114Z`. */
export type IsoDateTime = string;

export type CurrencyCode = 'CAD' | 'USD' | 'EUR';
export type AccountType = 'checking' | 'savings' | 'credit_card' | 'cash' | 'investment';
export type TransactionStatus = 'posted' | 'pending';
export type CategoryKind = 'expense' | 'income';
export type ScheduledItemKind = 'bill' | 'income';
export type ScheduledItemStatus = 'active' | 'paused';
export type OccurrenceStatus = 'posted' | 'skipped' | 'overdue' | 'scheduled';
export type Frequency = 'once' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type ProjectStatus = 'active' | 'planned' | 'completed' | 'archived';
export type Granularity = 'day' | 'week' | 'month' | 'year';
export type Direction = 'inflow' | 'outflow';

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

/** Single records come back as `{ data }`. */
export interface Single<T> {
  data: T;
}

/** Collections come back as `{ data, meta }`. Reports return their own shapes. */
export interface Collection<T, M = ListMeta> {
  data: T[];
  meta: M;
}

export interface ListMeta {
  total: number;
  count: number;
  page: number;
  pageSize: number;
  offset: number;
  totalPages: number;
  hasMore: boolean;
  /** Echo of the applied sort, e.g. `-date,-createdAt`. */
  sort?: string;
}

export interface ApiErrorBody {
  error: {
    code:
      | 'BAD_REQUEST'
      | 'VALIDATION_ERROR'
      | 'INVALID_REFERENCE'
      | 'CURRENCY_MISMATCH'
      | 'NOT_AN_OCCURRENCE'
      | 'UNSUPPORTED_OPERATION'
      | 'NOT_FOUND'
      | 'ROUTE_NOT_FOUND'
      | 'CONFLICT'
      | 'MALFORMED_JSON'
      | 'SIMULATED_ERROR'
      | 'INTERNAL_ERROR';
    message: string;
    /** Present on validation failures: one entry per offending field. */
    details?: Array<{ path: string; code?: string; message: string }>;
  };
}

/** Bulk endpoints report per-item outcomes and answer 207 on partial success. */
export interface BulkResult<T> {
  data: T[];
  errors: Array<{ index?: number; id?: string; error: ApiErrorBody['error'] }>;
  meta: { requested: number; created?: number; updated?: number; failed: number };
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  /** Immutable. Every transaction on the account is in this currency. */
  currency: CurrencyCode;
  /** Balance before the first transaction in the ledger. */
  openingBalance: Minor;
  /** Credit cards only, positive. `availableCredit = creditLimit + balance`. */
  creditLimit: Minor | null;
  color: string;
  openedAt: IsoDate;
  archivedAt: IsoDate | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Attached by list/read endpoints unless `includeBalances=false`. */
  balance?: Balance | null;
}

/**
 * Balances are derived, never stored. `posted` and `pending` are separate because
 * "the balance" is ambiguous once a card pre-authorisation is in flight.
 */
export interface Balance {
  accountId: string;
  currency: CurrencyCode;
  asOf: IsoDate;
  openingBalance: Minor;
  /** Opening balance + every posted transaction up to `asOf`. */
  posted: Minor;
  /** The pending rows alone, usually negative. */
  pending: Minor;
  /** posted + pending. */
  available: Minor;
  transactionCount: number;
  pendingCount: number;
  creditLimit: Minor | null;
  availableCredit: Minor | null;
}

export interface CurrencyTotal {
  currency: CurrencyCode;
  posted: Minor;
  pending: Minor;
  available: Minor;
  accountCount: number;
}

/** Totals are never summed across currencies — there are no FX rates here. */
export interface BalanceSnapshot {
  asOf: IsoDate;
  balances: Balance[];
  totalsByCurrency: Partial<Record<CurrencyCode, CurrencyTotal>>;
}

export interface BalanceHistory {
  accountId: string;
  currency: CurrencyCode;
  granularity: Granularity;
  range: { from: IsoDate; to: IsoDate };
  openingBalance: Minor;
  series: Array<{
    key: string;
    start: IsoDate;
    end: IsoDate;
    inflow: Minor;
    outflow: Minor;
    net: Minor;
    closingBalance: Minor;
  }>;
}

export interface Transaction {
  id: string;
  accountId: string;
  /** The day it happened. Compare as a string; do not parse into a Date blindly. */
  date: IsoDate;
  amount: Minor;
  /** Always equal to the account's currency. */
  currency: CurrencyCode;
  description: string;
  merchant: string | null;
  categoryId: string | null;
  projectId: string | null;
  status: TransactionStatus;
  /** Set on both legs of a transfer. Reports exclude these by default. */
  transferId: string | null;
  /** Set when this row was generated from a scheduled item. */
  scheduledItemId: string | null;
  notes: string | null;
  tags: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;

  /** Present with `?include=…`. */
  account?: Pick<Account, 'id' | 'name' | 'currency' | 'color' | 'type'> | null;
  category?: Pick<Category, 'id' | 'name' | 'color' | 'kind' | 'parentId'> | null;
  project?: Pick<Project, 'id' | 'name' | 'currency' | 'color' | 'status'> | null;
  scheduledItem?: Pick<ScheduledItem, 'id' | 'name' | 'currency' | 'frequency'> | null;
  /** Present with `?withRunningBalance=true`. `null` for pending rows. */
  runningBalance?: Minor | null;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  /** One level of nesting only: a child never has children. */
  parentId: string | null;
  /** Minor units per month; `null` means not budgeted. */
  monthlyBudget: Minor | null;
  color: string;
  archivedAt: IsoDate | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  childIds?: string[];
  transactionCount?: number;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  currency: CurrencyCode;
  budget: Minor | null;
  startDate: IsoDate;
  endDate: IsoDate | null;
  color: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  summary?: ProjectSummary | null;
}

export interface ProjectSummary {
  projectId: string;
  currency: CurrencyCode;
  budget: Minor | null;
  outflow: Minor;
  inflow: Minor;
  /** Net cash out the door (outflow - inflow). Compare this to `budget`. */
  spent: Minor;
  /** Sum of future scheduled items linked to the project. */
  committed: Minor;
  projectedTotal: Minor;
  budgetRemaining: Minor | null;
  budgetUsedRatio: number | null;
  overBudget: boolean;
  transactionCount: number;
  firstTransactionDate: IsoDate | null;
  lastTransactionDate: IsoDate | null;
  byCategory: CategoryTotals[];
  byMonth: Array<{
    month: IsoMonth;
    inflow: Minor;
    outflow: Minor;
    net: Minor;
    transactionCount: number;
  }>;
  upcoming: Occurrence[];
  /** More than one entry means the totals above mix currencies. */
  currenciesInvolved: CurrencyCode[];
}

/**
 * A rule, not a row: `startDate` + `frequency` generate dates on demand.
 * Monthly-family items stay anchored to their day of month and clamp in short
 * months (the 31st becomes Feb 28, then back to Mar 31).
 */
export interface ScheduledItem {
  id: string;
  name: string;
  kind: ScheduledItemKind;
  accountId: string;
  categoryId: string | null;
  projectId: string | null;
  /** Signed like a transaction: bills negative, income positive. */
  amount: Minor;
  currency: CurrencyCode;
  frequency: Frequency;
  startDate: IsoDate;
  endDate: IsoDate | null;
  autoPay: boolean;
  status: ScheduledItemStatus;
  notes: string | null;
  /** Expected swing around `amount` — a hint for the UI, not enforced. */
  variance: Minor;
  skippedDates: IsoDate[];
  postedOccurrences: Array<{ date: IsoDate; transactionId: string }>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Derived on read: next date that is neither posted nor skipped. */
  nextDueDate: IsoDate | null;
}

export interface Occurrence {
  scheduledItemId: string;
  name: string;
  date: IsoDate;
  amount: Minor;
  currency: CurrencyCode;
  accountId: string;
  categoryId: string | null;
  projectId: string | null;
  kind: ScheduledItemKind;
  status: OccurrenceStatus;
  /** Set when the occurrence has been posted. */
  transactionId: string | null;
}

export interface UpcomingResponse {
  range: { from: IsoDate; to: IsoDate };
  occurrences: Occurrence[];
  totals: {
    inflow: Minor;
    outflow: Minor;
    net: Minor;
    occurrenceCount: number;
    overdueCount: number;
  };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * Reporting vocabulary: `outflow` and `inflow` are magnitudes (>= 0) and
 * `net = inflow - outflow`. Classification follows the sign of the amount, not
 * the category's kind — a refund is an inflow even in an expense category.
 */
export interface CategoryTotals {
  categoryId: string | null;
  /** `Uncategorised` when `categoryId` is null. */
  name: string;
  parentId: string | null;
  kind: CategoryKind | null;
  color: string;
  monthlyBudget?: Minor | null;
  inflow: Minor;
  outflow: Minor;
  net: Minor;
  transactionCount: number;
  /** `monthlyBudget` scaled to the reported period. */
  budget?: Minor | null;
  budgetRemaining?: Minor | null;
  budgetUsedRatio?: number | null;
  overBudget?: boolean;
  /** Share of the period's total outflow, 0–1. Only on category-breakdown. */
  outflowShare?: number;
}

export interface ReportScope {
  accountIds: string[];
  includesPending: boolean;
  includesTransfers: boolean;
  projectIds?: string[] | null;
}

/** What the report left out, so the UI can say so instead of quietly losing money. */
export interface ReportExclusions {
  transferLegs: number;
  otherCurrencyTransactions: number;
  /** Right currency, still out of scope: archived, or filtered out by `accountId`. */
  outOfScopeTransactions: number;
  pendingTransactions: number;
}

export interface MonthlyExpensesReport {
  range: { from: IsoMonth; to: IsoMonth; startDate: IsoDate; endDate: IsoDate };
  currency: CurrencyCode;
  scope: ReportScope;
  months: Array<{
    month: IsoMonth;
    start: IsoDate;
    end: IsoDate;
    inflow: Minor;
    outflow: Minor;
    net: Minor;
    transactionCount: number;
    byCategory: CategoryTotals[];
  }>;
  totals: {
    inflow: Minor;
    outflow: Minor;
    net: Minor;
    transactionCount: number;
    monthCount: number;
    averageMonthlyOutflow: Minor;
    byCategory: CategoryTotals[];
  };
  excluded: ReportExclusions;
}

export interface CategoryBreakdownReport {
  range: { from: IsoDate; to: IsoDate };
  currency: CurrencyCode;
  scope: ReportScope;
  inflow: Minor;
  outflow: Minor;
  net: Minor;
  transactionCount: number;
  categories: CategoryTotals[];
  excluded: ReportExclusions;
}

export interface CashFlowReport {
  range: { from: IsoDate; to: IsoDate };
  granularity: Granularity;
  currency: CurrencyCode;
  scope: ReportScope;
  series: Array<{
    key: string;
    start: IsoDate;
    end: IsoDate;
    inflow: Minor;
    outflow: Minor;
    net: Minor;
    transactionCount: number;
    /** net / inflow, 0–1. `null` when there was no income in the bucket. */
    savingsRate: number | null;
  }>;
  totals: { inflow: Minor; outflow: Minor; net: Minor };
  excluded: ReportExclusions;
}

/**
 * Actual transactions cover dates up to `asOf`; scheduled occurrences cover
 * everything after it. Nothing is counted twice, and the bucket containing
 * `asOf` is a hybrid (`isPartiallyProjected`).
 */
export interface BudgetProjection {
  range: { from: IsoDate; to: IsoDate };
  granularity: Granularity;
  currency: CurrencyCode;
  asOf: IsoDate;
  scope: { accountIds: string[] };
  /** Balance across in-scope accounts the day before `range.from`. */
  startingBalance: Minor;
  endingBalance: Minor;
  /** The dip a user actually worries about. */
  lowestPoint: { key: string; date: IsoDate; balance: Minor } | null;
  goesNegative: boolean;
  series: Array<{
    key: string;
    start: IsoDate;
    end: IsoDate;
    isProjected: boolean;
    isPartiallyProjected: boolean;
    daysInBucket: number;
    projectedDays: number;
    actual: { inflow: Minor; outflow: Minor; net: Minor; transactionCount: number };
    scheduled: { inflow: Minor; outflow: Minor; net: Minor; occurrenceCount: number };
    /** Only non-zero with `includeCategoryBudgets=true`. A guess, labelled as one. */
    estimatedDiscretionary: Minor;
    inflow: Minor;
    outflow: Minor;
    net: Minor;
    closingBalance: Minor;
  }>;
  assumptions: {
    actualsThrough: IsoDate;
    forecastFrom: IsoDate;
    includesScheduled: boolean;
    includesPendingInStartingBalance: boolean;
    excludesTransfers: boolean;
    includesEstimatedDiscretionary: boolean;
    monthlyCategoryBudgetTotal: Minor | null;
    scheduledItemIds: string[];
    note: string;
  };
}

export interface Transfer {
  transferId: string;
  date: IsoDate;
  /** Positive magnitude; the legs carry the signs. */
  amount: Minor;
  currency: CurrencyCode;
  fromAccountId: string;
  toAccountId: string | null;
  description: string;
  status: TransactionStatus;
  legs: Array<{ id: string; accountId: string; amount: Minor }>;
  /** True when a leg was force-deleted and the pair no longer balances. */
  isOrphaned: boolean;
}
