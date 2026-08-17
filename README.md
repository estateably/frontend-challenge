# Personal Finance Manager — challenge starter

Starting point for the [Personal Finance Manager frontend challenge](docs/CHALLENGE.md):
a complete backend, and an empty React app for you to fill in.

The API exists so you can spend your time on the front end — accounts,
transactions, categories, projects, scheduled bills, reports and projections are
already there, already populated with 18 months of plausible data.

**Node + Express, entirely in memory.** No database, no migrations, no auth.
Restart and you are back to the same seed.

> The backend is **not evaluated** — it is scaffolding. You are free to use it as
> is, extend it, or throw it away and mock the API yourself. What we do want to
> talk about is the **data contract**: how accounts, transactions, categories and
> projections are modelled, and how your client consumes that model. If you
> disagree with a decision made here, that is a good discussion, not a problem.

---

## Quick start

```bash
npm install
```

```bash
npm run dev
```

That starts both processes with prefixed output; one Ctrl-C stops both.

- **API**: <http://localhost:4000/api> — that URL returns an index of every endpoint
- **Client**: <http://localhost:5173> — an empty React page, waiting for you
- Conventions and enums: <http://localhost:4000/api/meta>
- Health and row counts: <http://localhost:4000/api/health>

```bash
curl "http://localhost:4000/api/accounts/balances"
```

Run one side alone with `npm run dev:api` or `npm run dev:web`. `npm start` runs
the API without file watching, and `npm test` runs its test suite. Requires Node
20+ (built and tested on 22).

### The client folder

[`client/`](client) is a bare Vite + React scaffold — one component, no data
fetching, no design system, no opinions. It exists so `npm run dev` gives you
something to open, and it is **meant to be replaced or converted**: switch it to
TypeScript, bring your own tooling, or delete it and scaffold your own.

Its dev server proxies `/api` to the backend ([`vite.config.js`](client/vite.config.js)),
so `fetch('/api/accounts')` works from the client with no CORS involved. If you
run your own dev server instead, CORS on the API reflects whatever origin asks, so
any port works — pin it with `CORS_ORIGIN` if you prefer
(see [`server/.env.example`](server/.env.example)).

---

## The contract in one screen

Everything else is in [**docs/API.md**](docs/API.md); TypeScript definitions for
every shape are in [**docs/api-types.d.ts**](docs/api-types.d.ts) — copy that file
into your client.

**Money is always an integer number of minor units.** `-4599` is `-$45.99`.
Decimals are rejected with a `422` rather than rounded, so no float error can
enter the store. Negative is money out, positive is money in. A negative balance
means overdrawn, or owed on a credit card.

**Dates are `YYYY-MM-DD` strings with no timezone.** A transaction happens on a
day, not at an instant. They sort lexicographically. `createdAt`/`updatedAt` are
real UTC instants — different thing, different type.

**Balances are derived, never stored**, so `?asOf=2026-03-31` is the same code
path as today's balance. `posted`, `pending` and `available` are separate numbers
because "the balance" is ambiguous while a card hold is in flight.

**A transfer is two transactions sharing a `transferId`**, not a third record
type. Reports exclude both legs by default and tell you how many they dropped.

**Reports speak `inflow` / `outflow` / `net`.** The first two are magnitudes
(`>= 0`); classification follows the sign of the amount, not the category's kind,
so a refund is an inflow even in an expense category.

**No exchange rates exist here.** One account is in USD. Reports cover one
currency at a time and balance totals are grouped by currency, never summed
across them. Cross-currency transfers are refused rather than guessed.

---

## Where each user story lives

| # | Story | Endpoints |
|---|---|---|
| 1 | Accounts and their transactions | `/api/accounts`, `/api/transactions`, `/api/transfers` |
| 2 | Balance now, or as of any date | `/api/accounts/balances?asOf=`, `/api/accounts/:id/balance-history` |
| 3 | Expenses by category per month | `/api/reports/monthly-expenses` |
| 4 | Future bills and budget projection | `/api/scheduled-items`, `/api/scheduled-items/occurrences`, `/api/projections/budget` |
| 5 | Spending per project | `/api/projects/:id/summary` |

You are not expected to build all five. Pick what shows your thinking best.

---

## Things the API does on purpose

Because a mock that only ever returns the happy path is not much of a mock.

**It can be slow and it can fail, on demand.**

```bash
curl "http://localhost:4000/api/transactions?__latency=2000"   # loading states
curl "http://localhost:4000/api/reports/cash-flow?__error=500" # error boundaries
```

Headers work too (`x-simulate-latency`, `x-simulate-error`), and
`POST /api/dev/settings {"latencyMs":800,"errorRate":0.2}` makes it global until
you turn it off. `/api/dev/*` is never delayed or failed, so there is always a way
back.

**Bulk writes report partial success** — `POST /api/transactions/bulk` answers
`207` with a per-item `errors[]` when some rows fail. Partial-failure UI is hard
to design against a mock that can't produce it.

**It refuses destructive operations instead of doing them quietly.** Deleting an
account with history is a `409` that tells you how to proceed (`?force=true`, or
archive instead). Deleting a category offers `?reassignTo=`.

**More data on demand.** The default seed is ~1,100 transactions;
`POST /api/dev/reset {"scale":10}` gives ~6,600 — enough to make an unvirtualised
list feel bad. The API still answers every report in under 20ms, so anything slow
is on your side of the wire.

**The seed contains the awkward cases**: a genuine duplicate charge, a zero-amount
reversal, an $18,500 outlier, a pending hold that may never post, uncategorised
rows as a review queue, transactions on both sides of a month boundary, a bill
anchored to the 31st that has to clamp in February, a paused scheduled item, and a
second currency. The full list is at the end of [docs/API.md](docs/API.md#edge-cases-seeded-on-purpose).

---

## What is deliberately not here

| Not implemented | Why |
|---|---|
| Authentication / authorisation | Out of scope for the challenge |
| Persistence | In-memory is the point; restart is the reset button |
| Cursor pagination | Offset pagination in both styles (`page`/`pageSize`, `offset`/`limit`) is enough for an in-memory store. The trade-off is worth discussing, not faking |
| Exchange rates | Any rate would be invented, and wrong money is worse than absent money |
| Optimistic concurrency (ETags, `If-Match`) | Single user, single process |
| Real-time updates (SSE / WebSocket) | Poll, or invalidate after mutations |
| Category nesting deeper than one level | Every report would have to choose between leaf and rolled-up totals at every level, forever |
| Recurring transfers | A scheduled item targets one account; a transfer needs two |
| Attachments, receipts, reconciliation | Not needed by any user story |

---

## Layout

```
client/                       bare React scaffold — yours to replace
server/
├── src/
│   ├── index.js              boot: seed the store, start listening
│   ├── app.js                express wiring, CORS, error handling
│   ├── routes/               one file per resource; HTTP only, no domain logic
│   ├── services/
│   │   ├── balances.js       derived balances, history, running balance
│   │   ├── reports.js        monthly expenses, category breakdown, cash flow
│   │   ├── projections.js    budget projection, upcoming occurrences
│   │   ├── recurrence.js     expanding a scheduled rule into dates
│   │   └── query.js          the single "which transactions?" filter
│   ├── store/
│   │   ├── index.js          five Maps and a reset function
│   │   └── seed.js           the 18-month dataset, with its edge cases
│   ├── lib/                  money, dates, ids, validation, pagination, errors
│   └── middleware/           latency/failure simulation, error shaping
└── test/                     node:test — dates, recurrence, API, report invariants
docs/
├── API.md                    full endpoint reference
├── api-types.d.ts            TypeScript definitions for the whole contract
└── CHALLENGE.md              the challenge brief
```

Routes do HTTP: parse, validate, delegate, serialise. Everything that computes a
number lives in `services/`, which is why `/api/reports/monthly-expenses` and
`/api/projections/budget` cannot disagree about what counts as an expense.

### Tests

```bash
npm test
```

52 tests, covering the parts where a bug is silent rather than loud: calendar
arithmetic across month and year boundaries, recurrence clamping (a bill on the
31st in February), balance and running-balance arithmetic, report totals matching
the transactions they claim to cover, transfer exclusion, and the projection
invariant that nothing is counted as both actual and forecast. CRUD plumbing is
not tested — it is the part that fails loudly.

---

## Notes for the discussion

Some of the modelling choices here are genuinely arguable, and we would rather
hear your view than have you assume ours:

- **Derived vs. stored.** Balances, running balances, project totals and
  `nextDueDate` are all computed per request. That is trivially correct and
  obviously not what you would do at scale. Where would you draw the line, and
  what would you cache on the client?
- **Where the computation lives.** The running balance is server-side because a
  client cannot compute it from one page. Monthly category rollups are *not* —
  the report returns leaf categories and `parentId`. Would you move either?
- **The projection seam.** Actuals up to today, scheduled items after: one bucket
  is a hybrid. How would you render that honestly?
- **Scheduled items are rules, not rows.** Nothing is materialised in advance,
  which keeps the forecast live but makes "mark this one paid" awkward
  (`postedOccurrences`, keyed by date). Would you have materialised instead?
- **`?include=`** exists to avoid N+1 fetches, and the ledger returns bare
  foreign keys by default. Which does your data layer actually want?
