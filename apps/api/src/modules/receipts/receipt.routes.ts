import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { escapeRegex, PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, ObjectIdParam, objectIdString, route } from '../../common/http/route.js';
import { assertBranchAccess, branchFilter, requireTenant, type RequestContext } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { getEtaService } from '../eta/eta-integration.service.js';
import { PaymentModel } from '../payments/payment.model.js';
import { enqueueSafely } from '../../jobs/queue.js';
import { ETA_STATUSES, type EtaStatus } from './eta-status.js';
import { receiptView } from './receipt-view.js';
import { correctReceipt } from './correction.service.js';
import { ReceiptModel } from './receipt.model.js';

async function loadReceipt(ctx: RequestContext, id: string) {
  const r = await ReceiptModel.findOne({ _id: id, tenantId: requireTenant(ctx) });
  if (!r) throw AppError.notFound('Receipt');
  assertBranchAccess(ctx, r.branchId);
  return r;
}

export function receiptRouter(): Router {
  const router = Router();
  mount(router, '/receipts', [
    route({
      method: 'get', path: '', tag: 'Receipts', permission: 'receipts:read', summary: 'Search receipts',
      query: PaginationQuery.extend({
        branchId: objectIdString.optional(), deviceId: objectIdString.optional(), kind: z.enum(['SALE', 'RETURN']).optional(),
        etaStatus: z.enum(ETA_STATUSES).optional(), receiptNumber: z.string().max(50).optional(), uuid: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        from: z.coerce.date().optional(), to: z.coerce.date().optional(),
      }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx), ...branchFilter(ctx, query.branchId) };
        if (query.deviceId) filter.deviceId = new Types.ObjectId(query.deviceId);
        if (query.kind) filter.kind = query.kind;
        if (query.etaStatus) filter['eta.status'] = query.etaStatus;
        if (query.uuid) filter.uuid = query.uuid;
        if (query.receiptNumber) filter.receiptNumber = new RegExp(`^${escapeRegex(query.receiptNumber)}`);
        if (query.from || query.to) filter.dateTimeIssued = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lt: query.to } : {}) };
        const [items, total] = await Promise.all([
          ReceiptModel.find(filter).select('-lines -eta.history').sort({ dateTimeIssued: -1 }).skip(skipOf(query)).limit(query.pageSize),
          ReceiptModel.countDocuments(filter),
        ]);
        return toPage(items.map((r) => receiptView(r)), total, query);
      },
    }),
    route({
      method: 'get', path: '/:id', tag: 'Receipts', permission: 'receipts:read', summary: 'Receipt detail with ETA status, errors and payments', params: ObjectIdParam,
      handler: async ({ ctx, params }) => {
        const r = await loadReceipt(ctx, params.id);
        const [payments, returns] = await Promise.all([
          PaymentModel.find({ tenantId: r.tenantId, receiptId: r._id }).sort({ recordedAt: 1 }),
          r.kind === 'SALE' ? ReceiptModel.find({ tenantId: r.tenantId, originalReceiptId: r._id }).select('receiptNumber uuid totals.totalAmount eta.status dateTimeIssued') : [],
        ]);
        return { ...receiptView(r), payments: payments.map((p) => p.toJSON()), returnReceipts: returns.map((x) => x.toJSON()) };
      },
    }),
    route({
      method: 'post', path: '/:id/print', tag: 'Receipts', permission: 'receipts:reprint', summary: 'Record a (re)print and return printable data', params: ObjectIdParam,
      handler: async ({ ctx, params }) => {
        const r = await loadReceipt(ctx, params.id);
        await ReceiptModel.updateOne({ _id: r._id, tenantId: r.tenantId }, { $inc: { printCount: 1 } });
        if (r.printCount > 0) await recordAudit({ ...fromContext(ctx), branchId: r.branchId, action: 'receipt.reprinted', entityType: 'Receipt', entityId: r._id, changes: { printCount: r.printCount + 1 } });
        return { ...receiptView(r), printCount: r.printCount + 1, copy: r.printCount > 0 };
      },
    }),
    route({
      method: 'post', path: '/:id/submit', tag: 'Receipts', permission: 'receipts:submit',
      summary: 'Queue a receipt for ETA submission (or re-queue after a FAILED submission was fixed)', params: ObjectIdParam,
      body: z.object({ reason: z.string().min(3).max(300).default('manual submission') }),
      handler: async ({ ctx, params, body }) => {
        const r = await loadReceipt(ctx, params.id);
        const svc = getEtaService();
        const status = r.eta.status as EtaStatus;
        let moved = 0;
        if (status === 'NOT_SUBMITTED') moved = await svc.queueNotSubmitted(r.tenantId, [r._id]);
        else if (status === 'FAILED') moved = await svc.requeueFailed(r.tenantId, [r._id], body.reason);
        else throw AppError.businessRule(`A receipt in status ${status} cannot be queued`, 'INVALID_ETA_STATE');
        if (moved) await enqueueSafely('eta.submit-device', { tenantId: String(r.tenantId), deviceId: String(r.deviceId) }, { jobId: `submit:${r.deviceId}` });
        await recordAudit({ ...fromContext(ctx), branchId: r.branchId, action: 'receipt.queued_for_eta', entityType: 'Receipt', entityId: r._id, summary: body.reason, changes: { from: status } });
        return receiptView((await ReceiptModel.findOne({ _id: r._id, tenantId: r.tenantId }))!);
      },
    }),
    route({
      method: 'post', path: '/:id/correct', tag: 'Receipts', status: 201, permission: 'receipts:submit',
      summary: 'Issue a corrected receipt (new UUID, referenceOldUUID) for a rejected, invalid or failed receipt',
      description: 'Only identification data can be corrected: item codes, unit types, descriptions and buyer details. Allowed within 96 hours of issuance.',
      params: ObjectIdParam,
      body: z.object({
        reason: z.string().min(3).max(500),
        useCurrentProductCodes: z.boolean().optional(),
        lines: z.array(z.object({ lineNo: z.number().int().min(1), itemType: z.enum(['GS1', 'EGS']).optional(), itemCode: z.string().min(1).max(100).optional(), unitType: z.string().min(1).max(30).optional(), description: z.string().min(1).max(500).optional() })).max(300).optional(),
        buyer: z.object({ type: z.enum(['P', 'B', 'F']), name: z.string().min(1).max(100).optional(), identity: z.string().min(1).max(40).optional(), mobileNumber: z.string().max(30).optional() }).optional(),
      }),
      handler: async ({ ctx, params, body }) => receiptView(await correctReceipt(ctx, params.id, body)),
    }),
    route({
      method: 'post', path: '/:id/reconcile', tag: 'Receipts', permission: 'receipts:submit', summary: 'Ask ETA for the status of a receipt whose submission outcome is unknown', params: ObjectIdParam,
      handler: async ({ ctx, params }) => {
        const r = await loadReceipt(ctx, params.id);
        const status = await getEtaService().reconcileReceipt(r.tenantId, r._id);
        await recordAudit({ ...fromContext(ctx), branchId: r.branchId, action: 'receipt.reconciled', entityType: 'Receipt', entityId: r._id, changes: { status } });
        return { status };
      },
    }),
  ]);
  return router;
}
