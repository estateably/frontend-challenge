import { z } from 'zod';
import { ApiError, badRequest } from './errors.js';
import { isDate, isMonth } from './dates.js';
import { CURRENCIES } from './money.js';

/**
 * Shared field schemas. Keeping them in one place means the request contract and
 * the documented contract can't drift apart field by field.
 */
export const fields = {
  calendarDate: z.string().refine(isDate, 'must be a real calendar date in YYYY-MM-DD form'),
  month: z.string().refine(isMonth, 'must be a month in YYYY-MM form'),
  currency: z.enum(Object.keys(CURRENCIES)),
  /**
   * Amounts are integer minor units. Rejecting 45.99 here is intentional: it
   * forces the client to decide how it converts user input into cents, which is
   * exactly where float bugs would otherwise hide.
   */
  minorAmount: z
    .number({ invalid_type_error: 'must be an integer number of minor units (cents), not a decimal' })
    .int('must be an integer number of minor units (cents), e.g. -4599 for -$45.99')
    .safe(),
  nonEmptyString: z.string().trim().min(1).max(200),
  optionalText: z.string().trim().max(2000).nullish(),
  id: z.string().trim().min(1).max(64),
};

export const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'cash', 'investment'];
export const TRANSACTION_STATUSES = ['posted', 'pending'];
export const CATEGORY_KINDS = ['expense', 'income'];
export const SCHEDULED_KINDS = ['bill', 'income'];
export const FREQUENCIES = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
export const PROJECT_STATUSES = ['active', 'planned', 'completed', 'archived'];
export const GRANULARITIES = ['day', 'week', 'month', 'year'];

/** Parses a body/query with zod and turns failures into a 422 with per-field details. */
export function parse(schema, value, { source = 'body' } = {}) {
  const result = schema.safeParse(value);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || source,
      code: issue.code,
      message: issue.message,
    }));
    throw new ApiError(422, 'VALIDATION_ERROR', `Invalid request ${source}`, details);
  }

  return result.data;
}

/** `?accountId=a&accountId=b` and `?accountId=a,b` both mean the same thing. */
export function listParam(value) {
  if (value === undefined) return undefined;
  const values = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

export function boolParam(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (['true', '1', 'yes'].includes(String(value).toLowerCase())) return true;
  if (['false', '0', 'no'].includes(String(value).toLowerCase())) return false;
  throw badRequest(`Expected a boolean ('true' or 'false'), received '${value}'`);
}

export function intParam(value, { name, min, max, fallback }) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw badRequest(`'${name}' must be an integer, received '${value}'`);
  if (min !== undefined && parsed < min) throw badRequest(`'${name}' must be >= ${min}`);
  if (max !== undefined && parsed > max) throw badRequest(`'${name}' must be <= ${max}`);
  return parsed;
}

export function dateParam(value, { name, fallback }) {
  if (value === undefined || value === '') return fallback;
  if (!isDate(String(value))) {
    throw badRequest(`'${name}' must be a calendar date in YYYY-MM-DD form, received '${value}'`);
  }
  return String(value);
}

export function monthParam(value, { name, fallback }) {
  if (value === undefined || value === '') return fallback;
  if (!isMonth(String(value))) {
    throw badRequest(`'${name}' must be a month in YYYY-MM form, received '${value}'`);
  }
  return String(value);
}

export function enumParam(value, { name, allowed, fallback }) {
  if (value === undefined || value === '') return fallback;
  if (!allowed.includes(String(value))) {
    throw badRequest(`'${name}' must be one of: ${allowed.join(', ')}. Received '${value}'`);
  }
  return String(value);
}
