# API reference

Base URL: `http://localhost:4000/api` — `GET /api` returns a machine-readable index
of everything below, and `GET /api/meta` returns every enum plus these conventions.

TypeScript definitions for every shape here: [`api-types.d.ts`](./api-types.d.ts).

---

## Conventions

### Money

Every amount is **an integer number of minor units** (cents for CAD/USD/EUR).

```
-4599    an outflow of $45.99
 320000  an inflow of $3,200.00
```

Decimals are rejected with `422`, not rounded. Converting user input into minor
units is the client's job, and doing it at the edge is why nothing downstream can
accumulate a float error.

Sign convention, without exception:

| | meaning |
|---|---|
| `amount < 0` | money left the account — expense, bill, transfer out |
| `amount > 0` | money entered the account — income, refund, transfer in |
| `balance < 0` | overdrawn, or money owed on a credit card |

Credit limits are positive; `availableCredit = creditLimit + balance`.

### Dates

Calendar dates are `YYYY-MM-DD` strings with **no time and no timezone** — a
transaction happens on a day, not at an instant. They sort lexicographically, so
comparing them as strings is correct. `createdAt` / `updatedAt` are the opposite:
real ISO-8601 UTC instants.

Months are `YYYY-MM`. All ranges are **inclusive** at both ends.

> `new Date('2025-06-01')` parses as UTC midnight and renders as May 31 west of
> Greenwich. The seed contains transactions on the first and last day of a month
> specifically so this bug is visible if it happens.

### Currency

Each account has a currency and **there are no exchange rates in this API**.
Reports and projections work on one currency at a time (`?currency=CAD`, the
default) and cover only the accounts held in it. Balance totals are grouped by
currency and never summed across them. Cross-currency transfers are refused.

### Reporting vocabulary

| field | meaning |
|---|---|
| `outflow` | magnitude of money leaving, always `>= 0` |
| `inflow` | magnitude of money arriving, always `>= 0` |
| `net` | `inflow - outflow`, signed |

Classification follows **the sign of the amount, not the category's kind**. A
refund is an inflow even when its category is an expense one, which is why every
row carries all three numbers — gross vs. net is the client's call.

Two exclusions are applied by default and always reported back under `excluded`,
alongside `outOfScopeTransactions` (right currency, filtered out by `accountId` or
archived) and `pendingTransactions`:

- **transfer legs** — money moved between your own accounts is not income or
  expense; counting it inflates both sides. Override with `includeTransfers=true`.
- **other currencies** — see above.

### Envelopes

```jsonc
{ "data": { … } }                       // single record
{ "data": [ … ], "meta": { … } }        // collection
{ "error": { "code": …, "message": … } } // any failure
```

Reports and projections return their own top-level shape (no `data` wrapper) —
they are computed views, not records.

### Errors

| status | code | when |
|---|---|---|
| 400 | `BAD_REQUEST` | bad query string — unknown sort field, inverted range, mixed pagination styles |
| 404 | `NOT_FOUND` | `/:id` does not exist |
| 404 | `ROUTE_NOT_FOUND` | no such endpoint |
| 409 | `CONFLICT` | the request would destroy or unbalance data (see `message` for the way forward) |
| 422 | `VALIDATION_ERROR` | body failed validation — `details[]` has one entry per field |
| 422 | `INVALID_REFERENCE` | a foreign key in the body points at nothing |
| 422 | `CURRENCY_MISMATCH` | transaction currency ≠ account currency |
| 422 | `NOT_AN_OCCURRENCE` | posting a scheduled item on a date its rule never generates |
| 422 | `UNSUPPORTED_OPERATION` | e.g. a cross-currency transfer |
| 400 | `MALFORMED_JSON` | body is not JSON |
| 4xx/5xx | `SIMULATED_ERROR` | you asked for a failure (see [Simulating failure](#simulating-latency-and-failure)) |

```jsonc
// 422
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [
      { "path": "amount", "code": "invalid_type",
        "message": "must be an integer number of minor units (cents), e.g. -4599 for -$45.99" }
    ]
  }
}
```

Request bodies are **strict**: an unknown field is a `422`, so a typo'd payload
fails loudly instead of being silently dropped.

### Pagination, sorting, includes

```
?page=2&pageSize=50        classic pager
?offset=120&limit=60       windowed / virtualised lists
```

Both address the same rows; using both in one request is a `400`. Default page
size 25, max 500. `X-Total-Count` is set on list responses (and exposed to CORS).

```
?sort=-date,amount         '-' prefix = descending, later keys break ties
?include=account,category  embed relations instead of bare foreign keys
```

Sortable transaction fields: `date`, `amount`, `description`, `merchant`,
`status`, `createdAt`, `updatedAt`, `id`. Default `-date,-createdAt`.

There is **no cursor pagination** — with an in-memory store it would be theatre.
The trade-off (stable windows vs. jump-to-page) is worth discussing, not faking.

---

## Accounts

### `GET /api/accounts`

Balances are attached by default, since "show the balance of each account" is the
common case and fanning out N requests for it would be worse.

| query | default | |
|---|---|---|
| `asOf` | today | balance as of this date |
| `includeBalances` | `true` | set `false` for the bare records |
| `includeArchived` | `false` | |
| `type` | — | `checking`, `savings`, `credit_card`, `cash`, `investment` |
| `currency` | — | filter by currency |

```jsonc
{
  "data": [
    {
      "id": "acc_visa", "name": "Travel Rewards Visa", "type": "credit_card",
      "currency": "CAD", "openingBalance": -84300, "creditLimit": 1500000,
      "balance": {
        "asOf": "2026-08-17", "posted": -627122, "pending": -74500,
        "available": -701622, "availableCredit": 798378,
        "transactionCount": 472, "pendingCount": 1
      }
    }
  ],
  "meta": {
    "total": 5, "asOf": "2026-08-17",
    "totalsByCurrency": {
      "CAD": { "currency": "CAD", "posted": 5088419, "pending": -111450,
               "available": 4976969, "accountCount": 4 },
      "USD": { "currency": "USD", "posted": 1335181, "pending": 0,
               "available": 1335181, "accountCount": 1 }
    }
  }
}
```

### `GET /api/accounts/balances`

Every balance plus per-currency totals — the dashboard header in one request.
Accepts `asOf` and `includeArchived`.

### `GET /api/accounts/:id/balance?asOf=YYYY-MM-DD`

**User story 2.** The same computation at any point in time; balances are always
derived from the ledger, never stored.

### `GET /api/accounts/:id/balance-history`

Closing balance per bucket — the series behind a balance-over-time chart.

| query | default |
|---|---|
| `from` | 12 months ago (start of month) |
| `to` | today |
| `granularity` | `month` (`day`, `week`, `month`, `year`) |

Each bucket carries `inflow`, `outflow`, `net`, `closingBalance`, and
`closingBalance[n] === closingBalance[n-1] + net[n]` by construction.

### `POST /api/accounts` · `PATCH /api/accounts/:id`

```jsonc
{
  "name": "Joint Chequing", "type": "checking", "currency": "CAD",
  "institution": "Banque Nationale", "openingBalance": 125000,
  "openedAt": "2025-01-01", "creditLimit": null, "color": "#2563eb"
}
```

`currency` is immutable after creation — changing it would silently reinterpret
every historical amount on the account. `PATCH` also accepts `archivedAt`.

### `DELETE /api/accounts/:id`

`409` while transactions exist. `?force=true` cascades (transactions and
scheduled items go too) and reports what it removed. `PATCH archivedAt` is the
non-destructive alternative.

---

## Transactions

### `GET /api/transactions`

| query | |
|---|---|
| `accountId`, `categoryId`, `projectId`, `scheduledItemId`, `tag` | repeatable or comma-separated |
| `status` | `posted`, `pending` |
| `from`, `to` | inclusive calendar dates |
| `minAmount`, `maxAmount` | **signed** minor units — `maxAmount=-5000` means "spent $50 or more" |
| `direction` | `inflow` / `outflow` |
| `uncategorised` | `true` for the review queue, `false` for the rest |
| `unassigned` | `true` for rows with no project |
| `includeTransfers` | default `true` |
| `transfersOnly` | `true` for transfer legs alone |
| `q` | substring over description, merchant and notes |
| `withRunningBalance` | see below |

```
GET /api/transactions?accountId=acc_visa&from=2026-07-01&to=2026-07-31&direction=outflow&sort=amount&pageSize=50
```

#### `withRunningBalance=true`

Adds `runningBalance` to each row. Requires **exactly one** `accountId` and a
date sort (`400` otherwise), because a running balance across several accounts
has no meaning and one out of date order is not a balance.

It is computed over the account's **whole ledger**, not just the filtered page —
a cumulative figure that ignored hidden rows would be wrong. Pending rows get
`null`: they haven't settled, so there is no defensible total for them.

This is the one derived value the server offers per row. A client cannot compute
it from a single page without fetching everything before it, which is exactly the
kind of "where should this live?" question worth a paragraph in your README.

### `GET /api/transactions/:id`

One row. Also accepts `?include=account,category,project,scheduledItem`.

### `POST /api/transactions`

```jsonc
{
  "accountId": "acc_chequing",
  "date": "2026-08-14",
  "amount": -4599,            // integer minor units; 45.99 is a 422
  "description": "Metro Plus",
  "merchant": "Metro Plus",   // optional
  "categoryId": "cat_groceries",
  "projectId": null,
  "status": "posted",         // or "pending"
  "notes": null,
  "tags": []
}
```

`currency` is derived from the account. Sending a conflicting one is a
`CURRENCY_MISMATCH` rather than a silent overwrite.

### `POST /api/transactions/bulk`

`{ "transactions": [ … ] }`, max 1000. **Partial success is the point:**

| status | |
|---|---|
| `201` | all created |
| `207` | some created — `errors[]` carries the index and reason for each failure |
| `422` | none created |

```jsonc
{
  "data": [ { "id": "txn_a1b2c3d4e5", … } ],
  "errors": [ { "index": 1, "error": { "code": "VALIDATION_ERROR", … } } ],
  "meta": { "requested": 3, "created": 2, "failed": 1 }
}
```

### `POST /api/transactions/bulk-update`

Categorise a screenful in one request instead of fifty.

```jsonc
{ "ids": ["txn_00042", "txn_00043"], "patch": { "categoryId": "cat_groceries" } }
```

`patch` accepts `categoryId`, `projectId`, `status`, `tags`. Unknown ids come
back in `errors[]` with a `207`.

### `PATCH /api/transactions/:id` · `DELETE /api/transactions/:id`

Editing the amount or account of a **transfer leg** is a `409` — it would
unbalance the transfer. Deleting one leg is also a `409`; delete the transfer
instead (`?force=true` orphans the other leg if you really mean it).

---

## Transfers

A transfer is **not a third kind of record** — it is two transactions sharing a
`transferId`, one negative and one positive. Each account's ledger stays complete
on its own, and reports drop both legs with one rule instead of special-casing
account pairs.

### `POST /api/transfers`

```jsonc
{
  "fromAccountId": "acc_chequing",
  "toAccountId": "acc_savings",
  "amount": 50000,          // positive magnitude; the legs get the signs
  "date": "2026-08-02",
  "description": "Monthly saving",
  "status": "posted"
}
```

Same account both sides → `422`. Different currencies → `422
UNSUPPORTED_OPERATION`, because there is no rate to convert with.

### `GET /api/transfers` · `GET /api/transfers/:transferId` · `DELETE /api/transfers/:transferId`

`DELETE` removes both legs. `isOrphaned: true` marks a pair that has lost a leg.

---

## Categories

One level of nesting: a category may have a `parentId`, and a child may not
itself be a parent. Arbitrary depth would force every report to choose between
leaf and rolled-up totals at every level, forever.

`monthlyBudget` (minor units, nullable) drives the budget columns in reports.

### `GET /api/categories`

`?kind=expense|income`, `?includeArchived=true`, `?includeUsage=true` (adds
`transactionCount`). Each row carries `childIds`.

### `POST` · `PATCH` · `DELETE /api/categories/:id`

An in-use category is protected:

```
DELETE /api/categories/cat_coffee                        409
DELETE /api/categories/cat_coffee?reassignTo=cat_restaurants   moves the transactions
DELETE /api/categories/cat_coffee?force=true             leaves them uncategorised
```

---

## Projects

**User story 5.** A project is a *label with a budget*, not a container: a
transaction belongs to one account and optionally one project, so "spent on the
remodel" and "spent from chequing" stay independent questions.

### `GET /api/projects` · `GET /api/projects/:id/summary`

`?includeSummary=false` for the bare records; `?status=active,planned` to filter.

```jsonc
{
  "projectId": "proj_remodel", "currency": "CAD", "budget": 3400000,
  "outflow": 3160650, "inflow": 0,
  "spent": 3160650,          // outflow - inflow: compare this to budget
  "committed": 455000,       // future scheduled items linked to the project
  "projectedTotal": 3615650, // 93% of budget spent, but over once committed
  "budgetRemaining": 239350, "budgetUsedRatio": 0.9296, "overBudget": false,
  "transactionCount": 18,
  "firstTransactionDate": "2026-03-03", "lastTransactionDate": "2026-08-15",
  "byCategory": [ … ], "byMonth": [ … ], "upcoming": [ … ],
  "currenciesInvolved": ["CAD"]
}
```

`DELETE` unassigns transactions rather than deleting them — they really happened,
they just lose the label.

---

## Scheduled items (future bills and income)

**User story 4.** A scheduled item is a **rule, not a row**: `startDate` +
`frequency` generate dates on demand. Nothing is materialised in advance, so
editing an item instantly changes the whole forecast and there is no queue of
stale future rows. The cost is that "mark this one paid" needs somewhere to live —
`postedOccurrences` and `skippedDates`, keyed by date.

Monthly-family items stay anchored to their **day of month** and clamp in short
months: an item due on the 31st falls on Feb 28, then back on Mar 31. It never
drifts to the 28th permanently. (`sch_water` in the seed is exactly this case.)

`nextDueDate` is derived on read, so it cannot go stale.

### `GET /api/scheduled-items/occurrences`

The flat upcoming list: every rule expanded into dates, each annotated.

| status | |
|---|---|
| `posted` | a real transaction exists for it |
| `skipped` | explicitly dismissed for that date |
| `overdue` | due on or before today, neither posted nor skipped |
| `scheduled` | still in the future |

| query | default |
|---|---|
| `from` | today |
| `to` | `from` + 3 months |
| `status`, `accountId`, `projectId`, `kind` | — |

```jsonc
{
  "range": { "from": "2026-08-17", "to": "2026-11-17" },
  "occurrences": [
    { "scheduledItemId": "sch_netflix", "name": "Netflix", "date": "2026-08-20",
      "amount": -1699, "currency": "CAD", "accountId": "acc_visa",
      "categoryId": "cat_subscriptions", "projectId": null, "kind": "bill",
      "status": "scheduled", "transactionId": null }
  ],
  "totals": { "inflow": 2082750, "outflow": 1525282, "net": 557468,
              "occurrenceCount": 40, "overdueCount": 0 }
}
```

### `POST /api/scheduled-items`

```jsonc
{
  "name": "Rent", "kind": "bill", "accountId": "acc_chequing",
  "categoryId": "cat_rent", "projectId": null,
  "amount": -215000,          // bills must be negative, income positive
  "frequency": "monthly",     // once | weekly | biweekly | monthly | quarterly | yearly
  "startDate": "2026-09-01",  // for monthly-family, also fixes the day of month
  "endDate": null, "autoPay": true, "status": "active", "variance": 0
}
```

### `POST /api/scheduled-items/:id/post`

Turns one occurrence into a real transaction. The amount defaults to the
scheduled amount but can differ — the hydro bill never matches the estimate.

```jsonc
{ "date": "2026-09-15", "amount": -12480, "status": "posted" }
```

`422 NOT_AN_OCCURRENCE` if the rule doesn't fall on that date (the error lists
nearby valid dates). `409` if that occurrence was already posted. Once posted, it
disappears from the forecast.

### `POST /api/scheduled-items/:id/skip` · `/unskip`

`{ "date": "2026-09-15" }` — dismiss one date without touching the rule.

### `GET /api/scheduled-items/:id/occurrences` · `PATCH` · `DELETE`

`PATCH status: "paused"` takes an item out of every forecast without deleting it
(the seed ships one paused item, `sch_meal_kit`). `DELETE` keeps the transactions
the rule already produced and just unlinks them.

---

## Reports

### `GET /api/reports/monthly-expenses`

**User story 3.** Expenses by category, month by month, with budget comparison.

| query | default |
|---|---|
| `from`, `to` | `YYYY-MM`; last 6 months |
| `currency` | `CAD` |
| `accountId` | all accounts in that currency |
| `projectId` | — |
| `includePending` | `true` |
| `includeTransfers` | `false` |

```jsonc
{
  "range": { "from": "2026-07", "to": "2026-07",
             "startDate": "2026-07-01", "endDate": "2026-07-31" },
  "currency": "CAD",
  "scope": { "accountIds": ["acc_chequing","acc_savings","acc_visa","acc_cash"],
             "includesPending": true, "includesTransfers": false, "projectIds": null },
  "months": [
    {
      "month": "2026-07", "start": "2026-07-01", "end": "2026-07-31",
      "inflow": 2399785, "outflow": 1059544, "net": 1340241, "transactionCount": 62,
      "byCategory": [
        { "categoryId": "cat_rent", "name": "Rent", "parentId": "cat_housing",
          "kind": "expense", "color": "#475569", "monthlyBudget": 215000,
          "inflow": 0, "outflow": 215000, "net": -215000, "transactionCount": 1,
          "budget": 215000, "budgetRemaining": 0, "budgetUsedRatio": 1,
          "overBudget": false }
      ]
    }
  ],
  "totals": { "inflow": 2399785, "outflow": 1059544, "net": 1340241,
              "transactionCount": 62, "monthCount": 1,
              "averageMonthlyOutflow": 1059544, "byCategory": [ … ] },
  "excluded": { "transferLegs": 8, "otherCurrencyTransactions": 4,
                "outOfScopeTransactions": 0, "pendingTransactions": 0 }
}
```

Notes worth knowing before you build against it:

- Uncategorised spend is a row with `categoryId: null` and `name:
  "Uncategorised"`, not a separate bucket — one representation to render.
- `monthlyBudget` is the category's setting; `budget` is that setting scaled to
  the period, so in `totals.byCategory` it is `monthlyBudget × monthCount`.
- Child categories are reported as themselves and carry `parentId`. Rolling up to
  parents is left to the client on purpose.

### `GET /api/reports/category-breakdown`

One flat total per category over an arbitrary **date** range (`from`, `to`,
default this month), plus `outflowShare` (0–1) for pie charts.

### `GET /api/reports/cash-flow`

Inflow vs. outflow per bucket. `from`/`to` (default last 12 months),
`granularity` (default `month`), plus a `savingsRate` per bucket (`null` when
there was no income).

---

## Projections

### `GET /api/projections/budget`

**User story 4.** Where the total balance is heading.

| query | default |
|---|---|
| `from` | today |
| `to` | end of the 6th month out |
| `granularity` | `month` |
| `currency` | `CAD` |
| `accountId` | all accounts in that currency |
| `includeScheduled` | `true` |
| `includeCategoryBudgets` | `false` |
| `asOf` | today |

**The rule that makes it coherent:** dates up to and including `asOf` use
**actual transactions**; dates after it use **scheduled occurrences that have not
been posted**. Without that split, a rent payment that has already cleared would
be counted once as a transaction and again as this month's bill.

The consequence: the bucket containing `asOf` is a hybrid — part history, part
forecast. It is flagged `isPartiallyProjected`, and `actual` and `scheduled` stay
separate in every bucket so the client can render the seam however it likes.

Excluded from the forecast, deliberately: paused items, occurrences already
posted or skipped, transfers, and **discretionary spending**. This is a
*commitments* forecast, not a behavioural model — a projection that quietly
invented next month's grocery bill would look more useful and be less true.
`includeCategoryBudgets=true` bolts on a crude estimate from the monthly category
budgets, and the response labels it as an assumption rather than a fact.

`asOf` is movable, so you can ask what last month's projection would have said.

```jsonc
{
  "range": { "from": "2026-08-17", "to": "2027-01-31" },
  "granularity": "month", "currency": "CAD", "asOf": "2026-08-17",
  "startingBalance": 4001719,      // in-scope balance the day before `from`
  "endingBalance": 5245250,
  "lowestPoint": { "key": "2026-09", "date": "2026-09-30", "balance": 4058526 },
  "goesNegative": false,
  "series": [
    {
      "key": "2026-09", "start": "2026-09-01", "end": "2026-09-30",
      "isProjected": true, "isPartiallyProjected": false,
      "daysInBucket": 30, "projectedDays": 30,
      "actual":    { "inflow": 0, "outflow": 0, "net": 0, "transactionCount": 0 },
      "scheduled": { "inflow": 657050, "outflow": 908794, "net": -251744,
                     "occurrenceCount": 15 },
      "estimatedDiscretionary": 0,
      "inflow": 657050, "outflow": 908794, "net": -251744,
      "closingBalance": 4058526
    }
  ],
  "assumptions": {
    "actualsThrough": "2026-08-17", "forecastFrom": "2026-08-18",
    "includesScheduled": true, "includesPendingInStartingBalance": true,
    "excludesTransfers": true, "includesEstimatedDiscretionary": false,
    "monthlyCategoryBudgetTotal": null,
    "scheduledItemIds": ["sch_rent", "sch_salary", … ],
    "note": "Actual transactions are used up to asOf; scheduled occurrences after it. …"
  }
}
```

`closingBalance` chains: `closing[n] === closing[n-1] + net[n]`, and
`endingBalance` is the last one.

---

## Dev endpoints

Never delayed and never randomly failed, so there is always a way back out.

### `POST /api/dev/reset`

```jsonc
{ "months": 18, "scale": 1 }   // both optional
```

`scale` multiplies discretionary volume. The default gives ~1,100 transactions,
`scale: 4` about 2,900, and `scale: 10` (the maximum) about 6,600 — enough to make
an unvirtualised list feel bad. Reports stay well under 20ms either way, so slow
screens will be your rendering, not the API.

### `GET` / `POST /api/dev/settings`

```jsonc
{ "latencyMs": 800, "errorRate": 0.2 }   // 1 in 5 requests fails, all are slow
{ "latencyMs": 0, "errorRate": 0 }       // back to normal
```

### `GET /api/dev/stats`

Row counts, the seeded date span, and how many rows are pending, uncategorised
or transfer legs.

---

## Simulating latency and failure

Per request, which is usually what you want while building a specific screen:

```
x-simulate-latency: 1500          ?__latency=1500
x-simulate-error: 503             ?__error=503
```

Globally, until you turn it off, via `POST /api/dev/settings` above.

```bash
# a slow list, for the loading state
curl "http://localhost:4000/api/transactions?__latency=2000"

# a failing report, for the error boundary
curl "http://localhost:4000/api/reports/monthly-expenses?__error=500"
```

---

## The seed data

Deterministic (fixed-seed PRNG — the same data on every restart) and anchored to
today: 18 months of history ending today, with scheduled items running into the
future. "This month" is always populated and projections always have something to
project.

- **5 accounts** — chequing, savings, a credit card with a limit, a cash wallet,
  and a **USD** account so multi-currency is real rather than theoretical
- **24 categories**, some nested, most with a monthly budget
- **~1,000 transactions** (`scale` for more), including transfers, pending rows,
  refunds, and ~2% uncategorised as a review queue
- **3 projects** — an active kitchen remodel, a planned trip to France with
  deposits already paid, and a completed home office
- **18 scheduled items** — rent, biweekly salary, variable utilities, quarterly
  and yearly bills, one-off future payments tied to projects, and one paused item

### Edge cases seeded on purpose

Every one of these has broken a real finance UI:

| | where to find it |
|---|---|
| Two transactions straddling a month boundary | last day of last month, first day of this month — any accidental UTC/local conversion moves them into the wrong month's report |
| A genuine duplicate (same day, merchant, amount) | ~9 days ago on the Visa — not an error to de-duplicate |
| A zero-amount row | a pre-authorisation reversal |
| A very large amount | an $18,500 RRSP transfer, for column widths and integer assumptions |
| A pending pre-authorisation that may never post | hotel hold on the Visa — "the balance" has to mean posted-only or including-pending, and you have to pick |
| A row with no category and no merchant | `POS PURCHASE 8841` |
| A bill anchored to the 31st | `sch_water`, quarterly — watch it clamp in February |
| A refund inside an expense flow | positive amounts in the ledger |
| A paused scheduled item | `sch_meal_kit` — must not appear in projections |
| A second currency | `acc_usd`, with activity every month |
