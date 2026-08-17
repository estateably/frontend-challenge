import { badRequest } from './errors.js';
import { intParam } from './validate.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 500;

/**
 * Offset pagination, addressable two ways:
 *   ?page=3&pageSize=50   — for classic pagers
 *   ?offset=120&limit=60  — for windowed / virtualised lists
 *
 * There is no cursor pagination. With an in-memory store it would be theatre,
 * and the trade-off (stable windows vs. jump-to-page) is worth discussing rather
 * than papering over.
 */
export function parsePagination(query) {
  const hasOffset = query.offset !== undefined || query.limit !== undefined;
  const hasPage = query.page !== undefined || query.pageSize !== undefined;

  if (hasOffset && hasPage) {
    throw badRequest("Use either 'page'/'pageSize' or 'offset'/'limit', not both");
  }

  const limit = intParam(query.limit, {
    name: 'limit',
    min: 1,
    max: MAX_PAGE_SIZE,
    fallback: intParam(query.pageSize, {
      name: 'pageSize',
      min: 1,
      max: MAX_PAGE_SIZE,
      fallback: DEFAULT_PAGE_SIZE,
    }),
  });

  const page = intParam(query.page, { name: 'page', min: 1, fallback: 1 });
  const offset = intParam(query.offset, { name: 'offset', min: 0, fallback: (page - 1) * limit });

  return { limit, offset, page: hasOffset ? Math.floor(offset / limit) + 1 : page };
}

export function paginated(rows, { limit, offset, page }) {
  const data = rows.slice(offset, offset + limit);
  return {
    data,
    meta: {
      total: rows.length,
      count: data.length,
      page,
      pageSize: limit,
      offset,
      totalPages: Math.max(1, Math.ceil(rows.length / limit)),
      hasMore: offset + data.length < rows.length,
    },
  };
}

/**
 * `?sort=-date,amount` — a `-` prefix means descending. Multiple keys break ties
 * left to right, which matters for a ledger where dozens of rows share a date.
 */
export function parseSort(value, { allowed, fallback }) {
  const raw = value === undefined || value === '' ? fallback : String(value);

  return raw.split(',').map((part) => {
    const trimmed = part.trim();
    const desc = trimmed.startsWith('-');
    const field = desc ? trimmed.slice(1) : trimmed;

    if (!allowed.includes(field)) {
      throw badRequest(
        `Cannot sort by '${field}'. Sortable fields: ${allowed.join(', ')} (prefix with '-' for descending)`,
      );
    }

    return { field, direction: desc ? -1 : 1 };
  });
}

export function applySort(rows, sort) {
  return [...rows].sort((a, b) => {
    for (const { field, direction } of sort) {
      const left = a[field];
      const right = b[field];
      if (left === right) continue;
      // null/undefined sort last regardless of direction.
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      const comparison = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
      if (comparison !== 0) return comparison * direction;
    }
    return 0;
  });
}
