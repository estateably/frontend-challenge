import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import apiRouter from './routes/index.js';
import { simulate } from './middleware/simulate.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export default function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // Reflects whatever origin asks, because the client's dev port is the client's
  // business (5173, 3000, 4200…). Set CORS_ORIGIN to pin it down.
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? true,
      exposedHeaders: ['X-Total-Count'],
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  // Derived data is never cacheable here: every balance and report is computed
  // from the live store, and a stale 304 would be indistinguishable from a bug.
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/', (req, res) => res.redirect('/api'));
  app.use('/api', simulate, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
