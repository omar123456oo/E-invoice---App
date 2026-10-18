import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { encryptSecret } from '../../common/crypto/crypto.js';
import { mount, ObjectIdParam, objectIdString, route } from '../../common/http/route.js';
import { assertBranchAccess, branchFilter, requireTenant } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { BranchModel } from '../branches/branch.model.js';
import { PosDeviceModel } from './pos-device.model.js';
import { ReceiptModel } from '../receipts/receipt.model.js';
import { getEtaServiceOrNull } from '../eta/eta-integration.service.js';

const DeviceBody = z.object({
  branchId: objectIdString,
  name: z.string().min(1).max(120),
  code: z.string().regex(/^[A-Za-z0-9]{1,10}$/),
  serialNumber: z.string().min(1).max(100),
  osVersion: z.string().min(1).max(50),
  modelFramework: z.string().min(1).max(10),
});

const CredentialsBody = z.object({
  clientId: z.string().min(1).max(100),
  clientSecret: z.string().min(1).max(100),
  presharedKey: z.string().max(200).default(''),
});

export function posDeviceRouter(): Router {
  const router = Router();
  mount(router, '/pos-devices', [
    route({
      method: 'get', path: '', tag: 'POS', permission: 'pos:devices:read', summary: 'List POS devices',
      query: z.object({ branchId: objectIdString.optional() }),
      handler: async ({ ctx, query }) =>
        (await PosDeviceModel.find({ tenantId: requireTenant(ctx), ...branchFilter(ctx, query.branchId) }).sort({ name: 1 })).map((d) => ({
          ...d.toJSON(),
          credentialsConfigured: Boolean(d.etaCredentialsUpdatedAt),
        })),
    }),
    route({
      method: 'post', path: '', tag: 'POS', status: 201, permission: 'pos:devices:manage', summary: 'Register a POS device', body: DeviceBody,
      handler: async ({ ctx, body }) => {
        const tenantId = requireTenant(ctx);
        assertBranchAccess(ctx, body.branchId);
        if (!(await BranchModel.exists({ _id: body.branchId, tenantId }))) throw AppError.notFound('Branch');
        const d = await PosDeviceModel.create({ ...body, tenantId });
        await recordAudit({ ...fromContext(ctx), action: 'pos_device.created', entityType: 'PosDevice', entityId: d._id, branchId: d.branchId, changes: body });
        return d.toJSON();
      },
    }),
    route({
      method: 'patch', path: '/:id/status', tag: 'POS', permission: 'pos:devices:manage',
      summary: 'Change device status (ACTIVE after ETA activation is confirmed)',
      params: ObjectIdParam, body: z.object({ status: z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'DEACTIVATED']) }),
      handler: async ({ ctx, params, body }) => {
        const tenantId = requireTenant(ctx);
        const d = await PosDeviceModel.findOne({ _id: params.id, tenantId });
        if (!d) throw AppError.notFound('POS device');
        assertBranchAccess(ctx, d.branchId);
        const from = d.status;
        d.status = body.status;
        await d.save();
        await recordAudit({ ...fromContext(ctx), action: 'pos_device.status_changed', entityType: 'PosDevice', entityId: d._id, branchId: d.branchId, changes: { status: { from, to: body.status } } });
        return d.toJSON();
      },
    }),
    route({
      method: 'put', path: '/:id/eta-credentials', tag: 'POS', permission: 'eta:manage',
      summary: 'Store ETA POS credentials (encrypted at rest, write-only)',
      params: ObjectIdParam, body: CredentialsBody,
      handler: async ({ ctx, params, body }) => {
        const tenantId = requireTenant(ctx);
        const res = await PosDeviceModel.updateOne(
          { _id: params.id, tenantId },
          { $set: { etaCredentialsEnc: encryptSecret(JSON.stringify(body)), etaCredentialsUpdatedAt: new Date() } },
        );
        if (res.matchedCount === 0) throw AppError.notFound('POS device');
        // New credentials remove the cause of credential/auth backoff: let queued receipts be retried immediately.
        await ReceiptModel.updateMany(
          { tenantId, deviceId: params.id, 'eta.status': 'QUEUED', 'eta.nextAttemptAt': { $ne: null } },
          { $set: { 'eta.nextAttemptAt': null, 'eta.lastError': { code: null, message: null, details: null } } },
        );
        getEtaServiceOrNull()?.forgetDeviceToken(tenantId, params.id);
        await recordAudit({ ...fromContext(ctx), action: 'pos_device.eta_credentials_updated', entityType: 'PosDevice', entityId: params.id, summary: 'Credentials replaced' });
        return undefined;
      },
    }),
  ]);
  return router;
}
