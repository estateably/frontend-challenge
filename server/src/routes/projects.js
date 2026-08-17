import { Router } from 'express';
import { z } from 'zod';
import { store, list, require_ } from '../store/index.js';
import { filterTransactions } from '../services/query.js';
import { projectSummary } from '../services/reports.js';
import { conflict } from '../lib/errors.js';
import { id } from '../lib/ids.js';
import * as d from '../lib/dates.js';
import { PROJECT_STATUSES, boolParam, enumParam, fields, listParam, parse } from '../lib/validate.js';

const router = Router();

/**
 * User story 5. A project is a *label with a budget*, not a container: a
 * transaction belongs to exactly one account and optionally one project, so
 * "spent on the remodel" and "spent from chequing" are independent questions.
 */
const createSchema = z
  .object({
    name: fields.nonEmptyString,
    description: fields.optionalText,
    status: z.enum(PROJECT_STATUSES).default('active'),
    currency: fields.currency.default('CAD'),
    /** Total budget in minor units. `null` means "track spend, no target". */
    budget: fields.minorAmount.nonnegative().nullish(),
    startDate: fields.calendarDate.optional(),
    endDate: fields.calendarDate.nullish(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex colour like #0284c7')
      .nullish(),
  })
  .strict();

const patchSchema = createSchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field to update' });

function assertDateOrder(startDate, endDate) {
  if (startDate && endDate && d.cmp(startDate, endDate) > 0) {
    throw conflict(`'startDate' (${startDate}) must not be after 'endDate' (${endDate})`);
  }
}

router.get('/', (req, res) => {
  const statuses = listParam(req.query.status)?.map((status) =>
    enumParam(status, { name: 'status', allowed: PROJECT_STATUSES }),
  );
  const withSummary = boolParam(req.query.includeSummary, true);

  const projects = list('projects')
    .filter((project) => (statuses ? statuses.includes(project.status) : true))
    .sort((a, b) => d.cmp(b.startDate, a.startDate));

  res.json({
    data: projects.map((project) => ({
      ...project,
      summary: withSummary ? projectSummary(project) : null,
    })),
    meta: { total: projects.length },
  });
});

router.get('/:id', (req, res) => {
  const project = require_('projects', req.params.id);
  res.json({ data: { ...project, summary: projectSummary(project) } });
});

/** GET /api/projects/:id/summary — spend, budget burn, per-category and per-month splits. */
router.get('/:id/summary', (req, res) => {
  const project = require_('projects', req.params.id);
  res.json({ data: projectSummary(project) });
});

router.post('/', (req, res) => {
  const body = parse(createSchema, req.body ?? {});
  const startDate = body.startDate ?? d.today();
  assertDateOrder(startDate, body.endDate);

  const now = d.nowIso();
  const project = {
    id: id('proj'),
    name: body.name,
    description: body.description ?? null,
    status: body.status,
    currency: body.currency,
    budget: body.budget ?? null,
    startDate,
    endDate: body.endDate ?? null,
    color: body.color ?? '#0891b2',
    createdAt: now,
    updatedAt: now,
  };

  store.projects.set(project.id, project);
  res.status(201).json({ data: { ...project, summary: projectSummary(project) } });
});

router.patch('/:id', (req, res) => {
  const project = require_('projects', req.params.id);
  const body = parse(patchSchema, req.body ?? {});

  assertDateOrder(body.startDate ?? project.startDate, body.endDate ?? project.endDate);
  Object.assign(project, body, { updatedAt: d.nowIso() });
  res.json({ data: { ...project, summary: projectSummary(project) } });
});

/**
 * DELETE /api/projects/:id
 * Transactions survive — they really happened. They just lose the label.
 */
router.delete('/:id', (req, res) => {
  const project = require_('projects', req.params.id);
  const transactions = filterTransactions({ projectIds: [project.id] });
  const scheduled = list('scheduledItems').filter((item) => item.projectId === project.id);

  for (const transaction of transactions) {
    transaction.projectId = null;
    transaction.updatedAt = d.nowIso();
  }
  for (const item of scheduled) {
    item.projectId = null;
    item.updatedAt = d.nowIso();
  }

  store.projects.delete(project.id);

  res.json({
    data: {
      deleted: { projects: 1 },
      unassigned: { transactions: transactions.length, scheduledItems: scheduled.length },
    },
  });
});

export default router;
