import { ApiError } from '../lib/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route for ${req.method} ${req.originalUrl}. See GET /api for the endpoint index.`,
    },
  });
}

/** Single exit point for errors, so every failure has the same body shape. */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ApiError) {
    return res.status(err.status).json(err.toJSON());
  }

  // Thrown by express.json() on a malformed body.
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' },
    });
  }

  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server' },
  });
}
