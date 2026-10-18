import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, objectIdString, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { ReceiptModel } from '../receipts/receipt.model.js';
import { TenantModel } from '../tenants/tenant.model.js';
import { EtaSubmissionModel } from './eta-submission.model.js';
import { getEtaService } from './eta-integration.service.js';
import { sweepTenant } from '../../jobs/sweeper.js';

export function etaRouter(): Router {
  const router = Router();
  mount(router, '/eta', [
    route({
      method: 'get', path: '/status', tag: 'ETA', permission: 'eta:read', summary: 'Integration configuration and health for my company',
      handler: async ({ ctx }) => {
        const tenantId = requireTenant(ctx);
        const [tenant, counts, last] = await Promise.all([
          TenantModel.findById(tenantId).select('eta').lean(),
          ReceiptModel.aggregate([{ $match: { tenantId } }, { $group: { _id: '$eta.status', count: { $sum: 1 }, oldest: { $min: '$eta.statusChangedAt' } } }]),
          EtaSubmissionModel.find({ tenantId }).sort({ sentAt: -1 }).limit(5).lean(),
        ]);
        const svc = getEtaService();
        return {
          environment: svc.api.environment,
          configuredEnvironment: env().ETA_ENVIRONMENT,
          signingMode: env().ETA_SIGNING_MODE,
          simulated: svc.api.environment === 'simulated',
          onboarding: tenant?.eta,
          receiptsByStatus: counts.map((c) => ({ status: c._id, count: c.count, oldestSince: c.oldest })),
          recentSubmissions: last,
          warnings: [
            ...(svc.api.environment === 'simulated' ? ['SIMULATED ETA: no receipt is being sent to the Egyptian Tax Authority'] : []),
            ...(env().ETA_SIGNING_MODE === 'none' ? ['Submissions are unsigned; the issuer signature integration is not configured'] : []),
            ...(!tenant?.eta?.b2cTagConfirmed ? ['B2C tag not confirmed for this taxpayer'] : []),
          ],
        };
      },
    }),
    route({
      method: 'get', path: '/submissions', tag: 'ETA', permission: 'eta:read', summary: 'Submission attempts log',
      query: PaginationQuery.extend({ deviceId: objectIdString.optional(), status: z.enum(['SENDING', 'ACCEPTED', 'REJECTED', 'FAILED', 'UNKNOWN', 'RETRY_LATER']).optional() }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx) };
        if (query.deviceId) filter.deviceId = new Types.ObjectId(query.deviceId);
        if (query.status) filter.status = query.status;
        const [items, total] = await Promise.all([
          EtaSubmissionModel.find(filter).sort({ sentAt: -1 }).skip(skipOf(query)).limit(query.pageSize),
          EtaSubmissionModel.countDocuments(filter),
        ]);
        return toPage(items.map((s) => s.toJSON()), total, query);
      },
    }),
    route({
      method: 'post', path: '/process', tag: 'ETA', permission: 'eta:manage', summary: 'Run submission, polling and reconciliation now for my company',
      handler: async ({ ctx }) => {
        const tenantId = requireTenant(ctx);
        const result = await sweepTenant(tenantId);
        await recordAudit({ ...fromContext(ctx), action: 'eta.manual_processing', changes: result });
        return result;
      },
    }),
  ]);
  return router;
}
