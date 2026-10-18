import { waitUntil } from '@vercel/functions';
import { logger } from '../common/logging/logger.js';
import { runJob } from './handlers.js';
import type { EnqueueOptions, JobName, JobPayloads, JobQueue } from './queue.js';

/**
 * Queue for serverless hosting (Vercel), where no worker process exists.
 * Immediate jobs run after the response is sent, inside the same function
 * invocation (waitUntil). Delayed jobs are not scheduled: the cron sweep
 * (GET /api/v1/internal/cron/sweep) and the "Run now" button pick them up
 * from the database, which remains the source of truth.
 */
export class ServerlessQueue implements JobQueue {
  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void> {
    if (opts?.delayMs && opts.delayMs > 0) return;
    waitUntil(
      runJob(name, data).catch((err: unknown) => {
        logger.warn({ err, name }, 'Background job failed; the sweep will retry from the database');
      }),
    );
  }
  async close(): Promise<void> {}
}
