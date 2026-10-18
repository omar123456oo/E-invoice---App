import { logger } from '../common/logging/logger.js';

export interface JobPayloads {
  'eta.submit-device': { tenantId: string; deviceId: string };
  'eta.poll-submission': { tenantId: string; submissionUuid: string };
  'eta.reconcile-receipt': { tenantId: string; receiptId: string };
  'import.process': { tenantId: string; jobId: string };
}
export type JobName = keyof JobPayloads;

export interface EnqueueOptions {
  delayMs?: number;
  /** Deduplication key: a job with the same id is not enqueued twice while pending. */
  jobId?: string;
}

export interface JobQueue {
  enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void>;
  close(): Promise<void>;
}

/**
 * Used when no Redis is configured. Jobs are not run; the periodic sweeper
 * (jobs/sweeper.ts) picks up queued work from the database instead, so no
 * work is lost — the database, not the queue, is the source of truth.
 */
export class NoopQueue implements JobQueue {
  readonly enqueued: Array<{ name: JobName; data: unknown; opts?: EnqueueOptions }> = [];
  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void> {
    this.enqueued.push({ name, data, opts });
    logger.debug({ name, data }, 'Job recorded (no queue configured; sweeper will process)');
  }
  async close(): Promise<void> {}
}

let queue: JobQueue = new NoopQueue();
export const getJobQueue = (): JobQueue => queue;
export const setJobQueue = (q: JobQueue): void => {
  queue = q;
};

/** Enqueue failures must not fail the business operation that already committed. */
export async function enqueueSafely<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void> {
  try {
    await queue.enqueue(name, data, opts);
  } catch (err) {
    logger.warn({ err, name }, 'Enqueue failed; the sweeper will pick the work up');
  }
}
