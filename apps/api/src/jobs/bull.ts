import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { EnqueueOptions, JobName, JobPayloads, JobQueue } from './queue.js';

export const QUEUE_NAME = 'eta';

/** Retries use exponential backoff; jobs are idempotent because they re-read state from MongoDB. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 8,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 5000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

export function redisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export class BullJobQueue implements JobQueue {
  private readonly queue: Queue;
  constructor(url: string) {
    this.queue = new Queue(QUEUE_NAME, { connection: redisConnection(url), defaultJobOptions: DEFAULT_JOB_OPTIONS });
  }
  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void> {
    await this.queue.add(name, data, { delay: opts?.delayMs, jobId: opts?.jobId?.replace(/:/g, '-') });
  }
  async close(): Promise<void> {
    await this.queue.close();
  }
}
