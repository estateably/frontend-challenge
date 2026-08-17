/**
 * Every error leaves the API in the same shape:
 *
 *   { "error": { "code": "NOT_FOUND", "message": "...", "details": [...] } }
 *
 * `code` is a stable machine-readable string, `message` is human-readable, and
 * `details` is only present for validation failures.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);

export const notFound = (resource, id) =>
  new ApiError(404, 'NOT_FOUND', `${resource} '${id}' was not found`);

export const conflict = (message) => new ApiError(409, 'CONFLICT', message);

export const unprocessable = (message, details) =>
  new ApiError(422, 'UNPROCESSABLE_ENTITY', message, details);
