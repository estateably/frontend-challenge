import { notFound } from '../lib/errors.js';
import { buildSeed } from './seed.js';

/**
 * The entire "database": five Maps and a settings object, all process-local.
 * Restarting the server (or POST /api/dev/reset) restores the seed exactly.
 *
 * Maps are keyed by id. Collections are small enough (a few thousand rows) that
 * every query is a linear scan — deliberately, so there is no index to keep in
 * sync and the read paths stay obvious.
 */
export const store = {
  accounts: new Map(),
  categories: new Map(),
  projects: new Map(),
  transactions: new Map(),
  scheduledItems: new Map(),

  /** Chaos knobs for exercising loading / error states. See routes/dev.js. */
  settings: { latencyMs: 0, errorRate: 0 },

  meta: { seededAt: null, options: {} },
};

export function resetStore(options = {}) {
  const seed = buildSeed(options);

  for (const key of ['accounts', 'categories', 'projects', 'transactions', 'scheduledItems']) {
    store[key].clear();
    for (const record of seed[key]) store[key].set(record.id, record);
  }

  store.meta = { seededAt: new Date().toISOString(), options: seed.options };
  return store.meta;
}

export const list = (collection) => [...store[collection].values()];

export function find(collection, id) {
  return store[collection].get(id) ?? null;
}

const LABELS = {
  accounts: 'Account',
  categories: 'Category',
  projects: 'Project',
  transactions: 'Transaction',
  scheduledItems: 'Scheduled item',
};

/** Reads a record or throws the standard 404 — used by every `/:id` route. */
export function require_(collection, id) {
  const record = store[collection].get(id);
  if (!record) throw notFound(LABELS[collection] ?? collection, id);
  return record;
}
