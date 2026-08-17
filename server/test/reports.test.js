import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let api;
let today;

before(async () => {
  api = await startTestServer();
  const { body } = await api.get('/api/health');
  today = body.today;
});
after(() => api.close());

const monthKey = (date) => date.slice(0, 7);

describe('monthly expense report', () => {
  it('nets to the same totals as the transactions it covers', async () => {
    const month = monthKey(today);
    const { body } = await api.get(`/api/reports/monthly-expenses?from=${month}&to=${month}`);

    assert.equal(body.months.length, 1);
    const [row] = body.months;
    assert.equal(row.net, row.inflow - row.outflow);

    // Category rows add up to the month's totals.
    const outflow = row.byCategory.reduce((total, category) => total + category.outflow, 0);
    const inflow = row.byCategory.reduce((total, category) => total + category.inflow, 0);
    assert.equal(outflow, row.outflow);
    assert.equal(inflow, row.inflow);

    // And the month's totals match a raw query over the same window, with
    // transfers excluded the same way.
    const { body: raw } = await api.get(
      `/api/transactions?from=${row.start}&to=${row.end}&includeTransfers=false&accountId=${body.scope.accountIds.join(',')}&pageSize=500`,
    );
    const expected = raw.data.reduce(
      (totals, transaction) => {
        if (transaction.amount > 0) totals.inflow += transaction.amount;
        else totals.outflow += -transaction.amount;
        return totals;
      },
      { inflow: 0, outflow: 0 },
    );
    assert.deepEqual({ inflow: row.inflow, outflow: row.outflow }, expected);
  });

  it('excludes transfer legs and says how many it dropped', async () => {
    const month = monthKey(today);
    const { body } = await api.get(`/api/reports/monthly-expenses?from=${month}&to=${month}`);
    assert.ok(body.excluded.transferLegs > 0, 'the seed contains transfers in every month');
    assert.equal(body.scope.includesTransfers, false);

    const { body: withTransfers } = await api.get(
      `/api/reports/monthly-expenses?from=${month}&to=${month}&includeTransfers=true`,
    );
    assert.ok(withTransfers.months[0].outflow > body.months[0].outflow);
  });

  it('covers exactly one currency', async () => {
    const month = monthKey(today);
    const { body: cad } = await api.get(`/api/reports/monthly-expenses?from=${month}&to=${month}`);
    const { body: usd } = await api.get(
      `/api/reports/monthly-expenses?from=${month}&to=${month}&currency=USD`,
    );

    assert.deepEqual(cad.scope.accountIds.includes('acc_usd'), false);
    assert.deepEqual(usd.scope.accountIds, ['acc_usd']);
    assert.ok(cad.excluded.otherCurrencyTransactions > 0);
  });

  it('compares spend to the monthly budget and scales it over a range', async () => {
    const to = monthKey(today);
    const { body } = await api.get(`/api/reports/monthly-expenses?from=${to}&to=${to}`);
    const groceries = body.months[0].byCategory.find((row) => row.categoryId === 'cat_groceries');
    assert.equal(groceries.budget, 90_000);
    assert.equal(groceries.budgetRemaining, 90_000 - groceries.outflow);
    assert.equal(groceries.overBudget, groceries.outflow > 90_000);

    // Over six months the budget is six times as large.
    const { body: halfYear } = await api.get('/api/reports/monthly-expenses');
    assert.equal(halfYear.months.length, 6);
    const total = halfYear.totals.byCategory.find((row) => row.categoryId === 'cat_groceries');
    assert.equal(total.budget, 90_000 * 6);
  });

  it('rejects an inverted range and a malformed month', async () => {
    const { status: inverted } = await api.get(
      '/api/reports/monthly-expenses?from=2025-06&to=2025-01',
    );
    assert.equal(inverted, 400);

    const { status: malformed } = await api.get('/api/reports/monthly-expenses?from=2025-6');
    assert.equal(malformed, 400);
  });
});

describe('cash flow', () => {
  it('adds up across granularities', async () => {
    const from = `${monthKey(today)}-01`;
    const { body: monthly } = await api.get(
      `/api/reports/cash-flow?from=${from}&to=${today}&granularity=month`,
    );
    const { body: daily } = await api.get(
      `/api/reports/cash-flow?from=${from}&to=${today}&granularity=day`,
    );

    const dailyTotal = daily.series.reduce(
      (totals, bucket) => ({
        inflow: totals.inflow + bucket.inflow,
        outflow: totals.outflow + bucket.outflow,
      }),
      { inflow: 0, outflow: 0 },
    );

    assert.equal(dailyTotal.inflow, monthly.totals.inflow);
    assert.equal(dailyTotal.outflow, monthly.totals.outflow);
  });
});

describe('budget projection', () => {
  it('never counts a payment as both actual and scheduled', async () => {
    const monthStart = `${monthKey(today)}-01`;
    const { body } = await api.get(`/api/projections/budget?from=${monthStart}`);

    // The current bucket is a hybrid; later ones are pure forecast.
    const seam = body.series[0];
    assert.equal(seam.isPartiallyProjected, true);
    assert.ok(body.series.at(-1).isProjected);

    for (const bucket of body.series) {
      assert.equal(bucket.inflow, bucket.actual.inflow + bucket.scheduled.inflow);
      assert.equal(
        bucket.outflow,
        bucket.actual.outflow + bucket.scheduled.outflow + bucket.estimatedDiscretionary,
      );
      assert.equal(bucket.net, bucket.inflow - bucket.outflow);
    }

    // The actual half of the seam bucket is exactly month-to-date reality: if a
    // scheduled item were leaking into it, this would come out too high.
    const { body: flow } = await api.get(
      `/api/reports/cash-flow?from=${monthStart}&to=${today}&granularity=month`,
    );
    assert.equal(seam.actual.inflow, flow.totals.inflow);
    assert.equal(seam.actual.outflow, flow.totals.outflow);

    // Rent has already been paid this month, so the forecast must not add it again.
    assert.ok(seam.actual.outflow >= 215_000, 'rent is in the month-to-date actuals');
    const { body: rent } = await api.get(
      `/api/scheduled-items/sch_rent/occurrences?from=${monthStart}&to=${today}`,
    );
    assert.deepEqual(
      rent.data.filter((occurrence) => occurrence.status === 'scheduled'),
      [],
      'no past rent occurrence is still awaiting forecast',
    );

    assert.equal(body.assumptions.actualsThrough, today);
    assert.ok(body.assumptions.forecastFrom > today);
  });

  it('chains closing balances from the starting balance', async () => {
    const { body } = await api.get('/api/projections/budget');
    let running = body.startingBalance;
    for (const bucket of body.series) {
      running += bucket.net;
      assert.equal(bucket.closingBalance, running);
    }
    assert.equal(body.endingBalance, running);
  });

  it('starts from the real balance the day before the window', async () => {
    const { body: projection } = await api.get('/api/projections/budget');
    const { body: balances } = await api.get(
      `/api/accounts/balances?asOf=${projection.assumptions.actualsThrough}`,
    );

    // The projection opens with yesterday's closing position, so adding
    // everything that actually happened today lands on today's balance.
    assert.equal(
      balances.totalsByCurrency.CAD.available,
      projection.startingBalance + projection.series[0].actual.net,
    );
  });

  it('only adds a discretionary estimate when asked, and labels it', async () => {
    const { body: bare } = await api.get('/api/projections/budget');
    const { body: padded } = await api.get('/api/projections/budget?includeCategoryBudgets=true');

    assert.equal(bare.assumptions.includesEstimatedDiscretionary, false);
    assert.equal(bare.series.at(-1).estimatedDiscretionary, 0);
    assert.equal(padded.assumptions.includesEstimatedDiscretionary, true);
    assert.ok(padded.series.at(-1).estimatedDiscretionary > 0);
    assert.ok(padded.endingBalance < bare.endingBalance);
  });

  it('drops an occurrence from the forecast once it is posted', async () => {
    const { body: before } = await api.get('/api/projections/budget');
    const { body: item } = await api.get('/api/scheduled-items/sch_car_insurance');

    const scheduledBefore = before.series
      .flatMap((bucket) => [bucket])
      .reduce((total, bucket) => total + bucket.scheduled.outflow, 0);

    await api.post('/api/scheduled-items/sch_car_insurance/post', { date: item.data.nextDueDate });

    const { body: after } = await api.get('/api/projections/budget');
    const scheduledAfter = after.series.reduce(
      (total, bucket) => total + bucket.scheduled.outflow,
      0,
    );

    assert.equal(scheduledAfter, scheduledBefore - Math.abs(item.data.amount));
  });

  it('excludes paused items from the forecast', async () => {
    const { body: before } = await api.get('/api/projections/budget');
    const paused = before.assumptions.scheduledItemIds.includes('sch_meal_kit');
    assert.equal(paused, false, 'sch_meal_kit is paused in the seed');

    await api.patch('/api/scheduled-items/sch_meal_kit', { status: 'active' });
    const { body: after } = await api.get('/api/projections/budget');
    assert.ok(after.assumptions.scheduledItemIds.includes('sch_meal_kit'));
    assert.ok(after.endingBalance < before.endingBalance);
  });
});

describe('project spending', () => {
  it('sums spend, commitments and budget burn', async () => {
    const { body } = await api.get('/api/projects/proj_remodel/summary');

    assert.equal(body.data.spent, body.data.outflow - body.data.inflow);
    assert.equal(body.data.budgetRemaining, body.data.budget - body.data.spent);
    assert.equal(body.data.projectedTotal, body.data.spent + body.data.committed);
    assert.ok(body.data.committed > 0, 'the remodel has a contractor payment still to come');

    const byMonth = body.data.byMonth.reduce((total, month) => total + month.outflow, 0);
    assert.equal(byMonth, body.data.outflow);
  });

  it('keeps transactions when a project is deleted', async () => {
    const { body: summary } = await api.get('/api/projects/proj_office/summary');
    assert.ok(summary.data.transactionCount > 0);

    const { body: deleted } = await api.delete('/api/projects/proj_office');
    assert.equal(deleted.data.unassigned.transactions, summary.data.transactionCount);

    const { body: orphaned } = await api.get('/api/transactions?projectId=proj_office');
    assert.equal(orphaned.meta.total, 0);
  });
});
