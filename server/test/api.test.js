import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

let api;

before(async () => {
  api = await startTestServer();
});
after(() => api.close());

describe('accounts and balances', () => {
  it('lists accounts with balances and per-currency totals', async () => {
    const { status, body } = await api.get('/api/accounts');
    assert.equal(status, 200);
    assert.equal(body.data.length, 5);

    for (const account of body.data) {
      // available is exactly posted + pending — no rounding anywhere.
      assert.equal(account.balance.available, account.balance.posted + account.balance.pending);
    }

    // Currencies are totalled separately, never summed together.
    assert.deepEqual(Object.keys(body.meta.totalsByCurrency).sort(), ['CAD', 'USD']);
  });

  it('reports availableCredit against the card limit, not the balance sign', async () => {
    const { body } = await api.get('/api/accounts/acc_visa');
    const { balance } = body.data;
    assert.ok(balance.available < 0, 'a used credit card owes money');
    assert.equal(balance.availableCredit, balance.creditLimit + balance.available);
  });

  it('walks the balance backwards in time', async () => {
    const { body: today } = await api.get('/api/accounts/acc_chequing/balance');
    const { body: history } = await api.get(
      '/api/accounts/acc_chequing/balance-history?granularity=month',
    );

    // The last closing balance in the series is today's balance.
    assert.equal(history.data.series.at(-1).closingBalance, today.data.posted + today.data.pending);

    // Each bucket's closing balance is the previous one plus its net movement.
    let previous = history.data.openingBalance;
    for (const bucket of history.data.series) {
      assert.equal(bucket.closingBalance, previous + bucket.net);
      assert.equal(bucket.net, bucket.inflow - bucket.outflow);
      previous = bucket.closingBalance;
    }
  });

  it('refuses to delete an account that still has history', async () => {
    const { status, body } = await api.delete('/api/accounts/acc_cash');
    assert.equal(status, 409);
    assert.equal(body.error.code, 'CONFLICT');
    assert.match(body.error.message, /force=true/);
  });

  it('404s an unknown account with a stable error shape', async () => {
    const { status, body } = await api.get('/api/accounts/acc_nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });
});

describe('transactions', () => {
  it('paginates, sorts and reports the total', async () => {
    const { body, headers } = await api.get('/api/transactions?pageSize=10&sort=-date');
    assert.equal(body.data.length, 10);
    assert.ok(body.meta.total > 500);
    assert.equal(headers.get('x-total-count'), String(body.meta.total));

    const dates = body.data.map((transaction) => transaction.date);
    assert.deepEqual(dates, [...dates].sort().reverse());

    // offset/limit addresses the same window as page/pageSize.
    const { body: offsetPage } = await api.get('/api/transactions?offset=10&limit=10&sort=-date');
    const { body: secondPage } = await api.get('/api/transactions?page=2&pageSize=10&sort=-date');
    assert.deepEqual(
      offsetPage.data.map((t) => t.id),
      secondPage.data.map((t) => t.id),
    );
  });

  it('rejects mixing the two pagination styles', async () => {
    const { status, body } = await api.get('/api/transactions?page=2&offset=10');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'BAD_REQUEST');
  });

  it('filters by account, date range, direction and category', async () => {
    const { body } = await api.get(
      '/api/transactions?accountId=acc_visa&direction=outflow&pageSize=200',
    );
    assert.ok(body.data.length > 0);
    for (const transaction of body.data) {
      assert.equal(transaction.accountId, 'acc_visa');
      assert.ok(transaction.amount < 0);
    }

    const { body: uncategorised } = await api.get('/api/transactions?uncategorised=true&pageSize=200');
    assert.ok(uncategorised.meta.total > 0, 'the seed leaves a review queue on purpose');
    for (const transaction of uncategorised.data) assert.equal(transaction.categoryId, null);
  });

  it('embeds relations only when asked', async () => {
    const { body: lean } = await api.get('/api/transactions?pageSize=1');
    assert.equal(lean.data[0].account, undefined);

    const { body: rich } = await api.get('/api/transactions?pageSize=1&include=account,category');
    assert.equal(rich.data[0].account.id, rich.data[0].accountId);
    assert.ok('category' in rich.data[0]);

    const { status } = await api.get('/api/transactions?include=nonsense');
    assert.equal(status, 400);
  });

  it('computes a running balance for one account, and refuses otherwise', async () => {
    const { body } = await api.get(
      '/api/transactions?accountId=acc_savings&sort=date&pageSize=500&withRunningBalance=true',
    );

    const { body: account } = await api.get('/api/accounts/acc_savings');
    const posted = body.data.filter((transaction) => transaction.status === 'posted');
    assert.equal(posted.at(-1).runningBalance, account.data.balance.posted);

    // Each step differs by exactly that row's amount.
    for (let i = 1; i < posted.length; i += 1) {
      assert.equal(posted[i].runningBalance - posted[i - 1].runningBalance, posted[i].amount);
    }

    const { status } = await api.get('/api/transactions?withRunningBalance=true');
    assert.equal(status, 400);
  });

  it('rejects a decimal amount rather than rounding it', async () => {
    const { status, body } = await api.post('/api/transactions', {
      accountId: 'acc_chequing',
      date: '2025-06-14',
      amount: 45.99,
      description: 'Float sneaking in',
    });
    assert.equal(status, 422);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.equal(body.error.details[0].path, 'amount');
  });

  it('rejects unknown fields and bad references with a field path', async () => {
    const { status, body } = await api.post('/api/transactions', {
      accountId: 'acc_chequing',
      date: '2025-06-14',
      amount: -100,
      description: 'Typo in the payload',
      catgeoryId: 'cat_groceries',
    });
    assert.equal(status, 422);

    const { status: refStatus, body: refBody } = await api.post('/api/transactions', {
      accountId: 'acc_missing',
      date: '2025-06-14',
      amount: -100,
      description: 'Nowhere to put it',
    });
    assert.equal(refStatus, 422);
    assert.equal(refBody.error.code, 'INVALID_REFERENCE');
    assert.equal(refBody.error.details[0].path, 'accountId');
  });

  it('derives currency from the account and refuses a mismatch', async () => {
    const { body } = await api.post('/api/transactions', {
      accountId: 'acc_usd',
      date: '2025-06-14',
      amount: -1_000,
      description: 'US software',
    });
    assert.equal(body.data.currency, 'USD');

    const { status, body: mismatch } = await api.post('/api/transactions', {
      accountId: 'acc_usd',
      date: '2025-06-14',
      amount: -1_000,
      description: 'Wrong currency',
      currency: 'CAD',
    });
    assert.equal(status, 422);
    assert.equal(mismatch.error.code, 'CURRENCY_MISMATCH');
  });

  it('creates in bulk with partial success', async () => {
    const { status, body } = await api.post('/api/transactions/bulk', {
      transactions: [
        { accountId: 'acc_chequing', date: '2025-06-01', amount: -1_000, description: 'Fine' },
        { accountId: 'acc_chequing', date: 'yesterday', amount: -1_000, description: 'Bad date' },
        { accountId: 'acc_chequing', date: '2025-06-03', amount: -2_000, description: 'Also fine' },
      ],
    });

    assert.equal(status, 207);
    assert.equal(body.data.length, 2);
    assert.equal(body.errors.length, 1);
    assert.equal(body.errors[0].index, 1);
    assert.deepEqual(body.meta, { requested: 3, created: 2, failed: 1 });
  });

  it('categorises many rows in one request', async () => {
    const { body: page } = await api.get('/api/transactions?uncategorised=true&pageSize=3');
    const ids = page.data.map((transaction) => transaction.id);

    const { status, body } = await api.post('/api/transactions/bulk-update', {
      ids: [...ids, 'txn_missing'],
      patch: { categoryId: 'cat_groceries' },
    });

    assert.equal(status, 207);
    assert.equal(body.data.length, ids.length);
    assert.equal(body.errors[0].id, 'txn_missing');
    for (const transaction of body.data) assert.equal(transaction.categoryId, 'cat_groceries');
  });
});

describe('transfers', () => {
  it('creates two balanced legs and leaves total worth unchanged', async () => {
    const { body: before } = await api.get('/api/accounts/balances');
    const totalBefore = before.totalsByCurrency.CAD.available;

    const { status, body } = await api.post('/api/transfers', {
      fromAccountId: 'acc_chequing',
      toAccountId: 'acc_savings',
      amount: 25_000,
      date: '2025-07-04',
      description: 'Top up savings',
    });

    assert.equal(status, 201);
    assert.equal(body.data.legs.length, 2);
    assert.equal(body.data.legs[0].amount + body.data.legs[1].amount, 0);
    assert.equal(body.data.isOrphaned, false);

    const { body: after } = await api.get('/api/accounts/balances');
    assert.equal(after.totalsByCurrency.CAD.available, totalBefore);
  });

  it('refuses a cross-currency transfer instead of inventing a rate', async () => {
    const { status, body } = await api.post('/api/transfers', {
      fromAccountId: 'acc_chequing',
      toAccountId: 'acc_usd',
      amount: 10_000,
      date: '2025-07-04',
    });
    assert.equal(status, 422);
    assert.equal(body.error.code, 'UNSUPPORTED_OPERATION');
  });

  it('will not let one leg be deleted or unbalanced by accident', async () => {
    const { body: created } = await api.post('/api/transfers', {
      fromAccountId: 'acc_chequing',
      toAccountId: 'acc_savings',
      amount: 5_000,
      date: '2025-07-05',
    });
    const legId = created.data.legs[0].id;

    const { status: deleteStatus } = await api.delete(`/api/transactions/${legId}`);
    assert.equal(deleteStatus, 409);

    const { status: patchStatus } = await api.patch(`/api/transactions/${legId}`, { amount: -1 });
    assert.equal(patchStatus, 409);

    const { status: transferStatus, body: deleted } = await api.delete(
      `/api/transfers/${created.data.transferId}`,
    );
    assert.equal(transferStatus, 200);
    assert.equal(deleted.data.deleted.transactions, 2);
  });
});

describe('scheduled items', () => {
  it('derives nextDueDate and lists annotated occurrences', async () => {
    const { body } = await api.get('/api/scheduled-items');
    const rent = body.data.find((item) => item.id === 'sch_rent');
    assert.ok(rent.nextDueDate > body.meta.today, 'next due date is in the future');

    const paused = body.data.find((item) => item.status === 'paused');
    assert.equal(paused.nextDueDate, null, 'a paused item has nothing due');

    const { body: occurrences } = await api.get('/api/scheduled-items/occurrences');
    assert.ok(occurrences.occurrences.length > 0);
    for (const occurrence of occurrences.occurrences) {
      assert.ok(['posted', 'skipped', 'overdue', 'scheduled'].includes(occurrence.status));
    }
  });

  it('posts one occurrence into a real transaction, once', async () => {
    const { body: item } = await api.get('/api/scheduled-items/sch_rent');
    const date = item.data.nextDueDate;

    const { status, body } = await api.post('/api/scheduled-items/sch_rent/post', {
      date,
      amount: -217_500,
    });
    assert.equal(status, 201);
    assert.equal(body.data.transaction.scheduledItemId, 'sch_rent');
    assert.equal(body.data.transaction.amount, -217_500);

    const { status: repeatStatus } = await api.post('/api/scheduled-items/sch_rent/post', { date });
    assert.equal(repeatStatus, 409, 'posting the same occurrence twice is a conflict');

    const { status: badDateStatus, body: badDate } = await api.post(
      '/api/scheduled-items/sch_rent/post',
      { date: '2025-06-17' },
    );
    assert.equal(badDateStatus, 422);
    assert.equal(badDate.error.code, 'NOT_AN_OCCURRENCE');
  });

  it('enforces the sign convention on bills and income', async () => {
    const { status, body } = await api.post('/api/scheduled-items', {
      name: 'Backwards bill',
      kind: 'bill',
      accountId: 'acc_chequing',
      amount: 5_000,
      frequency: 'monthly',
      startDate: '2025-08-01',
    });
    assert.equal(status, 422);
    assert.equal(body.error.details[0].code, 'sign_mismatch');
  });
});

describe('failure simulation', () => {
  it('fails on demand and stays failing until reset', async () => {
    const { status, body } = await api.request('/api/accounts', {
      headers: { 'x-simulate-error': '503' },
    });
    assert.equal(status, 503);
    assert.equal(body.error.code, 'SIMULATED_ERROR');

    await api.post('/api/dev/settings', { errorRate: 1 });
    const { status: failed } = await api.get('/api/transactions');
    assert.equal(failed, 500);

    // /api/dev is never failed, so there is always a way back.
    const { status: recovered } = await api.post('/api/dev/settings', { errorRate: 0 });
    assert.equal(recovered, 200);
    const { status: ok } = await api.get('/api/transactions');
    assert.equal(ok, 200);
  });

  it('reseeds deterministically', async () => {
    const { body: first } = await api.post('/api/dev/reset', {});
    const { body: second } = await api.post('/api/dev/reset', {});
    assert.deepEqual(first.data.counts, second.data.counts);
    assert.equal(first.data.options.transactionCount, second.data.options.transactionCount);
  });
});
