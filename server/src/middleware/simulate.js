import { store } from '../store/index.js';
import { ApiError } from '../lib/errors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes the API misbehave on demand, so loading spinners, retries, error
 * boundaries and partial-failure states can be built against something real
 * instead of being hand-waved.
 *
 * Per request (highest precedence):
 *   x-simulate-latency: 1500     or  ?__latency=1500
 *   x-simulate-error: 503        or  ?__error=503
 *
 * Globally, until reset (see POST /api/dev/settings):
 *   { "latencyMs": 400, "errorRate": 0.25 }
 *
 * /api/dev/* is never delayed or failed — you always need a way back out.
 */
export function simulate(req, res, next) {
  if (req.path.startsWith('/dev')) return next();

  const requestedError = req.get('x-simulate-error') ?? req.query.__error;
  const requestedLatency = req.get('x-simulate-latency') ?? req.query.__latency;

  const latency = Number(requestedLatency ?? store.settings.latencyMs ?? 0);
  const delay = Number.isFinite(latency) ? Math.min(Math.max(latency, 0), 30_000) : 0;

  const run = async () => {
    if (delay > 0) await sleep(delay);

    if (requestedError !== undefined) {
      const status = Number(requestedError);
      throw new ApiError(
        Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500,
        'SIMULATED_ERROR',
        `Simulated failure requested by the client (${requestedError})`,
      );
    }

    if (store.settings.errorRate > 0 && Math.random() < store.settings.errorRate) {
      throw new ApiError(
        500,
        'SIMULATED_ERROR',
        `Simulated failure (errorRate is ${store.settings.errorRate}; clear it with POST /api/dev/settings)`,
      );
    }
  };

  run().then(next, next);
}
