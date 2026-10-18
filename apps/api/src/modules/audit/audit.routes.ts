import { Router } from 'express';
import { z } from 'zod';
import { escapeRegex, PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { AuditEventModel } from './audit-event.model.js';
import { fromContext, recordAudit, verifyChain } from './audit.service.js';

export function auditRouter(): Router {
  const router = Router();
  mount(router, '/audit-events', [
    route({
      method: 'get', path: '', tag: 'Audit', permission: 'audit:read', summary: 'Search the audit trail',
      query: PaginationQuery.extend({
        action: z.string().max(100).optional(), entityType: z.string().max(60).optional(), entityId: z.string().max(64).optional(),
        from: z.coerce.date().optional(), to: z.coerce.date().optional(),
      }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx) };
        if (query.action) filter.action = new RegExp(`^${escapeRegex(query.action)}`);
        if (query.entityType) filter.entityType = query.entityType;
        if (query.entityId) filter.entityId = query.entityId;
        if (query.from || query.to) filter.at = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lt: query.to } : {}) };
        const [items, total] = await Promise.all([
          AuditEventModel.find(filter).sort({ at: -1 }).skip(skipOf(query)).limit(query.pageSize),
          AuditEventModel.countDocuments(filter),
        ]);
        await recordAudit({ ...fromContext(ctx), action: 'audit.viewed', changes: { filter: { ...query } } });
        return toPage(items.map((e) => e.toJSON()), total, query);
      },
    }),
    route({
      method: 'get', path: '/verify', tag: 'Audit', permission: 'audit:read', summary: 'Verify the integrity of my company audit chain',
      handler: async ({ ctx }) => verifyChain(requireTenant(ctx)),
    }),
  ]);
  return router;
}
