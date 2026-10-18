import { Worker, type Job } from 'bullmq';
import { Types } from 'mongoose';
import { configureEta, configureMailer } from '../bootstrap.js';
import { env } from '../config/env.js';
import { connectMongo, disconnectMongo } from '../common/db/mongo.js';
import { logger } from '../common/logging/logger.js';
import { getEtaService } from '../modules/eta/eta-integration.service.js';
import { BullJobQueue, QUEUE_NAME, redisConnection } from './bull.js';
import { setJobQueue, type JobName, type JobPayloads } from './queue.js';
import { sweepAll } from './sweeper.js';
import { processImportJob } from '../modules/imports/import.service.js';
import { notify } from '../modules/notifications/notification.service.js';

/**
 * Background worker process. Handles ETA submission, polling and
 * reconciliation jobs, and runs the database sweeper every 30 s as a safety net.
 * Failed jobs stay in the BullMQ failed set (dead-letter) for 14 days.
 */
async function handle(job: Job): Promise<unknown> {
  const svc = getEtaService();
  switch (job.name as JobName) {
    case 'eta.submit-device': {
      const d = job.data as JobPayloads['eta.submit-device'];
      return svc.submitDevice(new Types.ObjectId(d.tenantId), new Types.ObjectId(d.deviceId));
    }
    case 'eta.poll-submission': {
      const d = job.data as JobPayloads['eta.poll-submission'];
      const res = await svc.pollSubmission(new Types.ObjectId(d.tenantId), d.submissionUuid);
      if (res.pending > 0) throw new Error(`${res.pending} receipt(s) still pending validation`); // retried with backoff
      return res;
    }
    case 'eta.reconcile-receipt': {
      const d = job.data as JobPayloads['eta.reconcile-receipt'];
      return svc.reconcileReceipt(new Types.ObjectId(d.tenantId), new Types.ObjectId(d.receiptId));
    }
    case 'import.process': {
      const d = job.data as JobPayloads['import.process'];
      return processImportJob(new Types.ObjectId(d.tenantId), new Types.ObjectId(d.jobId));
    }
    default:
      throw new Error(`Unknown job ${job.name}`);
  }
}

async function main(): Promise<void> {
  const cfg = env();
  if (!cfg.REDIS_URL) throw new Error('The worker requires REDIS_URL');
  await connectMongo(cfg.MONGODB_URI);
  configureEta();
  configureMailer();
  setJobQueue(new BullJobQueue(cfg.REDIS_URL));
  const worker = new Worker(QUEUE_NAME, handle, { connection: redisConnection(cfg.REDIS_URL), concurrency: 4 });
  worker.on('failed', (job, err) => {
    logger.warn({ job: job?.name, id: job?.id, attempts: job?.attemptsMade, err: err.message }, 'Job failed');
    const tenantId = (job?.data as { tenantId?: string } | undefined)?.tenantId;
    // Final failure only (moved to the failed set = dead-letter); polling "still pending" is not an incident.
    if (job && tenantId && job.attemptsMade >= (job.opts.attempts ?? 1) && job.name !== 'eta.poll-submission') {
      void notify({
        tenantId: new Types.ObjectId(tenantId), kind: 'JOB_FAILED', severity: 'critical', permission: 'eta:manage',
        title: { en: `Background job failed: ${job.name}`, ar: `فشلت مهمة في الخلفية: ${job.name}` },
        body: { en: err.message.slice(0, 400), ar: err.message.slice(0, 400) }, link: '/eta', dedupeKey: `job:${job.id}`,
      });
    }
  });
  const sweep = setInterval(() => void sweepAll(), 30_000);
  logger.info('Worker started');
  const stop = async () => {
    clearInterval(sweep);
    await worker.close();
    await disconnectMongo();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
