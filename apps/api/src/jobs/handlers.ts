import { Types } from 'mongoose';
import { getEtaService } from '../modules/eta/eta-integration.service.js';
import { processImportJob } from '../modules/imports/import.service.js';
import type { JobName, JobPayloads } from './queue.js';

/** One implementation of every background job, shared by the BullMQ worker and the serverless queue. */
export async function runJob<N extends JobName>(name: N, data: JobPayloads[N]): Promise<unknown> {
  switch (name) {
    case 'eta.submit-device': {
      const d = data as JobPayloads['eta.submit-device'];
      return getEtaService().submitDevice(new Types.ObjectId(d.tenantId), new Types.ObjectId(d.deviceId));
    }
    case 'eta.poll-submission': {
      const d = data as JobPayloads['eta.poll-submission'];
      return getEtaService().pollSubmission(new Types.ObjectId(d.tenantId), d.submissionUuid);
    }
    case 'eta.reconcile-receipt': {
      const d = data as JobPayloads['eta.reconcile-receipt'];
      return getEtaService().reconcileReceipt(new Types.ObjectId(d.tenantId), new Types.ObjectId(d.receiptId));
    }
    case 'import.process': {
      const d = data as JobPayloads['import.process'];
      return processImportJob(new Types.ObjectId(d.tenantId), new Types.ObjectId(d.jobId));
    }
    default:
      throw new Error(`Unknown job ${String(name)}`);
  }
}
