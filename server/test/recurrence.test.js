import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceDates, nextDueDate } from '../src/services/recurrence.js';

const item = (overrides) => ({
  id: 'sch_test',
  status: 'active',
  frequency: 'monthly',
  startDate: '2025-01-15',
  endDate: null,
  skippedDates: [],
  postedOccurrences: [],
  ...overrides,
});

describe('recurrence expansion', () => {
  it('keeps a monthly item anchored to its day of month', () => {
    // The classic bug: a bill due on the 31st drifts to the 28th forever.
    const dates = occurrenceDates(item({ startDate: '2025-01-31' }), '2025-01-01', '2025-06-30');
    assert.deepEqual(dates, [
      '2025-01-31',
      '2025-02-28',
      '2025-03-31',
      '2025-04-30',
      '2025-05-31',
      '2025-06-30',
    ]);
  });

  it('handles leap years', () => {
    const dates = occurrenceDates(item({ startDate: '2024-01-29' }), '2024-01-01', '2024-04-30');
    assert.deepEqual(dates, ['2024-01-29', '2024-02-29', '2024-03-29', '2024-04-29']);
  });

  it('expands weekly and biweekly by fixed day steps', () => {
    assert.deepEqual(
      occurrenceDates(item({ frequency: 'weekly', startDate: '2025-01-01' }), '2025-01-01', '2025-01-22'),
      ['2025-01-01', '2025-01-08', '2025-01-15', '2025-01-22'],
    );
    assert.deepEqual(
      occurrenceDates(item({ frequency: 'biweekly', startDate: '2025-01-03' }), '2025-02-01', '2025-03-01'),
      ['2025-02-14', '2025-02-28'],
    );
  });

  it('expands quarterly and yearly from the start date', () => {
    assert.deepEqual(
      occurrenceDates(item({ frequency: 'quarterly', startDate: '2025-01-31' }), '2025-01-01', '2025-12-31'),
      ['2025-01-31', '2025-04-30', '2025-07-31', '2025-10-31'],
    );
    assert.deepEqual(
      occurrenceDates(item({ frequency: 'yearly', startDate: '2024-02-29' }), '2024-01-01', '2027-01-01'),
      ['2024-02-29', '2025-02-28', '2026-02-28'],
    );
  });

  it('emits a one-off only inside the window', () => {
    const once = item({ frequency: 'once', startDate: '2025-05-09' });
    assert.deepEqual(occurrenceDates(once, '2025-01-01', '2025-12-31'), ['2025-05-09']);
    assert.deepEqual(occurrenceDates(once, '2025-06-01', '2025-12-31'), []);
  });

  it('stops at endDate and starts no earlier than startDate', () => {
    const bounded = item({ startDate: '2025-03-10', endDate: '2025-05-10' });
    assert.deepEqual(occurrenceDates(bounded, '2025-01-01', '2025-12-31'), [
      '2025-03-10',
      '2025-04-10',
      '2025-05-10',
    ]);
  });

  it('returns nothing for an inverted window', () => {
    assert.deepEqual(occurrenceDates(item({}), '2025-06-01', '2025-01-01'), []);
  });

  it('skips posted and skipped dates when finding what is next due', () => {
    const partly = item({
      startDate: '2025-01-05',
      skippedDates: ['2025-02-05'],
      postedOccurrences: [{ date: '2025-01-05', transactionId: 'txn_1' }],
    });
    assert.equal(nextDueDate(partly, '2025-01-01'), '2025-03-05');
    assert.equal(nextDueDate(item({ status: 'paused' }), '2025-01-01'), null);
  });
});
