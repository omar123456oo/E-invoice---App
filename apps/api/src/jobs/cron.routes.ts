import { Router } from 'express';
import { env } from '../config/env.js';
import { safeEqual } from '../common/crypto/crypto.js';
import { AppError } from '../common/errors/app-error.js';
import { mount, route } from '../common/http/route.js';
import { sweepAll } from './sweeper.js';

/**
 * Scheduled sweep for hosts without a worker process (Vercel Cron). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`. Disabled unless CRON_SECRET is set.
 */
export function cronRouter(): Router {
  const router = Router();
  mount(router, '/internal/cron', [
    route({
      method: 'get', path: '/sweep', tag: 'Internal', auth: false,
      summary: 'Run ETA submission/polling/reconciliation, imports and the email outbox (cron only)',
      handler: async ({ req }) => {
        const secret = env().CRON_SECRET;
        const header = req.headers.authorization ?? '';
        if (!secret) throw new AppError(404, 'ROUTE_NOT_FOUND', 'Not found');
        if (!safeEqual(header, `Bearer ${secret}`)) throw AppError.unauthorized('Invalid cron secret', 'INVALID_CRON_SECRET');
        const started = Date.now();
        await sweepAll();
        return { ok: true, durationMs: Date.now() - started };
      },
    }),
  ]);
  return router;
}
