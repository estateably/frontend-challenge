import { find } from '../store/index.js';
import { ApiError } from './errors.js';

const LABELS = {
  accounts: 'account',
  categories: 'category',
  projects: 'project',
  scheduledItems: 'scheduled item',
  transactions: 'transaction',
};

/**
 * Resolves a foreign key from a request body.
 *
 * A bad reference inside a body is a validation problem, not a missing page, so
 * this is a 422 with a field path — not the 404 that `/:id` routes return.
 */
export function requireRef(collection, value, path) {
  const record = find(collection, value);
  if (!record) {
    throw new ApiError(422, 'INVALID_REFERENCE', `Invalid ${LABELS[collection] ?? collection} reference`, [
      { path, code: 'invalid_reference', message: `No ${LABELS[collection] ?? collection} with id '${value}'` },
    ]);
  }
  return record;
}

/** Same, but `null`/`undefined` is allowed and returns null. */
export function optionalRef(collection, value, path) {
  return value === null || value === undefined ? null : requireRef(collection, value, path);
}
