import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { DECIMAL_STRING_RE } from '../../common/money/decimal.js';
import { PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, ObjectIdParam, objectIdString, route } from '../../common/http/route.js';
import { branchFilter, requireTenant } from '../../common/security/context.js';
import { PAYMENT_METHODS } from '../tenants/tenant.model.js';
import { IdempotencyKey } from '../sales/sales.routes.js';
import { ReturnModel } from './return.model.js';
import { completeReturn, createReturn, decideReturn } from './return.service.js';

export function returnRouter(): Router {
  const router = Router();
  mount(router, '/returns', [
    route({
      method: 'get', path: '', tag: 'Returns', permission: 'returns:read', summary: 'List returns',
      query: PaginationQuery.extend({ status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'COMPLETED']).optional(), branchId: objectIdString.optional() }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx), ...branchFilter(ctx, query.branchId) };
        if (query.status) filter.status = query.status;
        const [items, total] = await Promise.all([
          ReturnModel.find(filter).sort({ createdAt: -1 }).skip(skipOf(query)).limit(query.pageSize),
          ReturnModel.countDocuments(filter),
        ]);
        return toPage(items.map((r) => r.toJSON()), total, query);
      },
    }),
    route({
      method: 'post', path: '', tag: 'Returns', status: 201, permission: 'returns:create',
      summary: 'Request a return against an original sale receipt (requires Idempotency-Key header)',
      body: z.object({
        originalReceiptId: objectIdString,
        lines: z.array(z.object({ lineNo: z.number().int().min(1), quantity: z.string().regex(DECIMAL_STRING_RE) })).min(1).max(300),
        reason: z.string().min(3).max(500),
        refundMethod: z.enum(PAYMENT_METHODS),
        refundReference: z.string().min(1).max(40).optional(),
      }),
      handler: async ({ ctx, body, req }) => {
        const key = IdempotencyKey.safeParse(req.headers['idempotency-key']);
        if (!key.success) throw AppError.validation([{ path: 'headers.idempotency-key', message: key.error.issues[0]!.message }]);
        return createReturn(ctx, body, key.data);
      },
    }),
    route({
      method: 'post', path: '/:id/decision', tag: 'Returns', permission: 'returns:approve', summary: 'Approve or reject a pending return',
      params: ObjectIdParam, body: z.object({ approve: z.boolean(), notes: z.string().max(500).optional() }),
      handler: async ({ ctx, params, body }) => decideReturn(ctx, params.id, body.approve, body.notes),
    }),
    route({
      method: 'post', path: '/:id/complete', tag: 'Returns', permission: 'returns:create',
      summary: 'Issue the return receipt and record the refund in the open shift',
      params: ObjectIdParam, body: z.object({ deviceId: objectIdString }),
      handler: async ({ ctx, params, body }) => completeReturn(ctx, params.id, body.deviceId),
    }),
  ]);
  return router;
}
