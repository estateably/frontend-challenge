import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../src/lib/dates.js';

/**
 * Date handling is tested and money-shaped logic is tested; CRUD plumbing is not.
 * These are the functions where a subtle bug shows up as a transaction silently
 * landing in the wrong month.
 */
describe('calendar dates', () => {
  it('rejects dates that do not exist', () => {
    assert.equal(d.isDate('2025-02-28'), true);
    assert.equal(d.isDate('2025-02-30'), false);
    assert.equal(d.isDate('2025-13-01'), false);
    assert.equal(d.isDate('2025-1-1'), false);
    assert.equal(d.isDate('2025-02-29'), false); // 2025 is not a leap year
    assert.equal(d.isDate('2024-02-29'), true);
  });

  it('clamps month arithmetic instead of overflowing', () => {
    assert.equal(d.addMonths('2025-01-31', 1), '2025-02-28');
    assert.equal(d.addMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(d.addMonths('2025-03-31', -1), '2025-02-28');
    assert.equal(d.addMonths('2025-12-15', 1), '2026-01-15');
    assert.equal(d.addMonths('2025-01-15', -1), '2024-12-15');
  });

  it('crosses year boundaries by day', () => {
    assert.equal(d.addDays('2024-12-31', 1), '2025-01-01');
    assert.equal(d.addDays('2025-01-01', -1), '2024-12-31');
    assert.equal(d.diffDays('2024-12-31', '2025-01-01'), 1);
  });

  it('does not shift dates regardless of the local timezone', () => {
    // A UTC-based bug shows up here when TZ is behind or ahead of UTC.
    assert.equal(d.monthKey('2025-06-01'), '2025-06');
    assert.equal(d.startOfMonth('2025-06-30'), '2025-06-01');
    assert.equal(d.endOfMonth('2025-02-10'), '2025-02-28');
    assert.equal(d.endOfMonth('2024-02-10'), '2024-02-29');
  });

  it('clips the first and last bucket to the requested range', () => {
    const months = d.buckets('2025-01-15', '2025-03-02', 'month');
    assert.deepEqual(
      months.map((bucket) => [bucket.key, bucket.start, bucket.end]),
      [
        ['2025-01', '2025-01-15', '2025-01-31'],
        ['2025-02', '2025-02-01', '2025-02-28'],
        ['2025-03', '2025-03-01', '2025-03-02'],
      ],
    );
  });

  it('covers every day exactly once, whatever the granularity', () => {
    for (const granularity of ['day', 'week', 'month', 'year']) {
      const buckets = d.buckets('2024-11-07', '2025-03-05', granularity);
      const days = buckets.reduce(
        (total, bucket) => total + d.diffDays(bucket.start, bucket.end) + 1,
        0,
      );
      assert.equal(days, d.diffDays('2024-11-07', '2025-03-05') + 1, granularity);
      assert.equal(buckets[0].start, '2024-11-07');
      assert.equal(buckets.at(-1).end, '2025-03-05');
    }
  });
});
