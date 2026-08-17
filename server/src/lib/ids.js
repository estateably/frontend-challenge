import { randomBytes } from 'node:crypto';

/**
 * Ids are prefixed so a bare string in a log or a bug report is self-describing:
 * `txn_9f2a1c` is obviously a transaction.
 *
 * Seeded records use a stable counter instead of randomness, so ids survive a
 * server restart — handy if you hard-code one in a test or a fixture.
 */
const counters = new Map();

export function id(prefix) {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

export function seededId(prefix) {
  const next = (counters.get(prefix) ?? 0) + 1;
  counters.set(prefix, next);
  return `${prefix}_${String(next).padStart(5, '0')}`;
}

export function resetSeededIds() {
  counters.clear();
}
