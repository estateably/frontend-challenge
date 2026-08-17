import { Router } from 'express';
import { z } from 'zod';
import { store, list, require_ } from '../store/index.js';
import { filterTransactions } from '../services/query.js';
import { requireRef } from '../lib/refs.js';
import { ApiError, conflict } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import * as d from '../lib/dates.js';
import { CATEGORY_KINDS, boolParam, enumParam, fields, listParam, parse } from '../lib/validate.js';

const router = Router();

/**
 * Categories are one level deep: a category may have a `parentId`, and a child
 * may not itself be a parent. Arbitrary depth sounds more flexible but makes
 * every report choose between leaf totals and rolled-up totals at every level —
 * a cost the reports would pay forever.
 */
const createSchema = z
  .object({
    name: fields.nonEmptyString,
    kind: z.enum(CATEGORY_KINDS),
    parentId: fields.id.nullish(),
    /** Minor units per month. `null` means "not budgeted". */
    monthlyBudget: fields.minorAmount.nonnegative().nullish(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex colour like #16a34a')
      .nullish(),
  })
  .strict();

const patchSchema = createSchema
  .partial()
  .extend({ archivedAt: fields.calendarDate.nullish() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' });

function assertParent(parentId, selfId = null) {
  if (!parentId) return;
  const parent = requireRef('categories', parentId, 'parentId');
  if (parent.id === selfId) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid request body', [
      { path: 'parentId', code: 'self_parent', message: 'A category cannot be its own parent' },
    ]);
  }
  if (parent.parentId) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Invalid request body', [
      {
        path: 'parentId',
        code: 'too_deep',
        message: `Category '${parent.id}' is already a child. Category nesting is limited to one level.`,
      },
    ]);
  }
}

router.get('/', (req, res) => {
  const kinds = listParam(req.query.kind)?.map((kind) =>
    enumParam(kind, { name: 'kind', allowed: CATEGORY_KINDS }),
  );
  const includeArchived = boolParam(req.query.includeArchived, false);
  const withCounts = boolParam(req.query.includeUsage, false);

  const categories = list('categories')
    .filter((category) => (includeArchived ? true : !category.archivedAt))
    .filter((category) => (kinds ? kinds.includes(category.kind) : true))
    .sort((a, b) => a.name.localeCompare(b.name));

  const data = categories.map((category) => ({
    ...category,
    childIds: list('categories')
      .filter((child) => child.parentId === category.id)
      .map((child) => child.id),
    ...(withCounts
      ? { transactionCount: filterTransactions({ categoryIds: [category.id] }).length }
      : {}),
  }));

  res.json({ data, meta: { total: data.length } });
});

router.get('/:id', (req, res) => {
  const category = require_('categories', req.params.id);
  res.json({
    data: {
      ...category,
      childIds: list('categories').filter((child) => child.parentId === category.id).map((child) => child.id),
      transactionCount: filterTransactions({ categoryIds: [category.id] }).length,
    },
  });
});

router.post('/', (req, res) => {
  const body = parse(createSchema, req.body ?? {});
  assertParent(body.parentId);

  const now = d.nowIso();
  const category = {
    id: id('cat'),
    name: body.name,
    kind: body.kind,
    parentId: body.parentId ?? null,
    monthlyBudget: body.monthlyBudget ?? null,
    color: body.color ?? '#71717a',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  store.categories.set(category.id, category);
  res.status(201).json({ data: category });
});

router.patch('/:id', (req, res) => {
  const category = require_('categories', req.params.id);
  const body = parse(patchSchema, req.body ?? {});

  if (body.parentId) assertParent(body.parentId, category.id);
  if (body.parentId && list('categories').some((child) => child.parentId === category.id)) {
    throw conflict(
      `Category '${category.id}' has children, so it cannot become a child itself (nesting is one level deep)`,
    );
  }

  Object.assign(category, body, { updatedAt: d.nowIso() });
  res.json({ data: category });
});

/**
 * DELETE /api/categories/:id
 * In-use categories are protected. `?reassignTo=cat_x` moves the transactions,
 * `?force=true` leaves them uncategorised — silently orphaning data is not a
 * default worth having.
 */
router.delete('/:id', (req, res) => {
  const category = require_('categories', req.params.id);
  const force = boolParam(req.query.force, false);
  const reassignTo = req.query.reassignTo ? String(req.query.reassignTo) : null;
  const transactions = filterTransactions({ categoryIds: [category.id] });
  const children = list('categories').filter((child) => child.parentId === category.id);

  if (transactions.length && !force && !reassignTo) {
    throw conflict(
      `Category '${category.id}' is used by ${transactions.length} transaction(s). ` +
        'Retry with ?reassignTo=<categoryId> to move them, or ?force=true to leave them uncategorised.',
    );
  }

  const replacement = reassignTo ? requireRef('categories', reassignTo, 'reassignTo') : null;
  if (replacement && replacement.id === category.id) {
    throw conflict('Cannot reassign a category to itself');
  }

  for (const transaction of transactions) {
    transaction.categoryId = replacement?.id ?? null;
    transaction.updatedAt = d.nowIso();
  }
  for (const child of children) {
    child.parentId = null;
    child.updatedAt = d.nowIso();
  }
  for (const item of list('scheduledItems').filter((entry) => entry.categoryId === category.id)) {
    item.categoryId = replacement?.id ?? null;
    item.updatedAt = d.nowIso();
  }

  store.categories.delete(category.id);

  res.json({
    data: {
      deleted: { categories: 1 },
      reassigned: { transactions: transactions.length, to: replacement?.id ?? null },
      orphanedChildren: children.map((child) => child.id),
    },
  });
});

export default router;
