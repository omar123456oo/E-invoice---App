import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { diff } from '../../common/db/diff.js';
import { mount, ObjectIdParam, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { BranchModel } from './branch.model.js';

export const BranchAddressBody = z.object({
  country: z.string().regex(/^[A-Z]{2}$/).default('EG'),
  governate: z.string().min(1).max(100),
  regionCity: z.string().min(1).max(100),
  street: z.string().min(1).max(200),
  buildingNumber: z.string().min(1).max(100),
  postalCode: z.string().max(30).nullable().optional(),
  floor: z.string().max(100).nullable().optional(),
  room: z.string().max(100).nullable().optional(),
  landmark: z.string().max(500).nullable().optional(),
  additionalInformation: z.string().max(500).nullable().optional(),
});

const BranchBody = z.object({
  name: z.string().min(1).max(120),
  etaBranchCode: z.string().min(1).max(50),
  activityCode: z.string().max(10).nullable().optional(),
  address: BranchAddressBody,
  phone: z.string().max(30).nullable().optional(),
  isActive: z.boolean().optional(),
});

export function branchRouter(): Router {
  const router = Router();
  mount(router, '/branches', [
    route({
      method: 'get', path: '', tag: 'Branches', permission: 'branches:read', summary: 'List branches visible to me',
      handler: async ({ ctx }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx) };
        if (ctx.branchIds !== 'ALL') filter._id = { $in: ctx.branchIds };
        return (await BranchModel.find(filter).sort({ name: 1 })).map((b) => b.toJSON());
      },
    }),
    route({
      method: 'post', path: '', tag: 'Branches', status: 201, permission: 'branches:manage', summary: 'Register a branch', body: BranchBody,
      handler: async ({ ctx, body }) => {
        const b = await BranchModel.create({ ...body, tenantId: requireTenant(ctx) });
        await recordAudit({ ...fromContext(ctx), action: 'branch.created', entityType: 'Branch', entityId: b._id, branchId: b._id, changes: body });
        return b.toJSON();
      },
    }),
    route({
      method: 'patch', path: '/:id', tag: 'Branches', permission: 'branches:manage', summary: 'Update a branch',
      params: ObjectIdParam, body: BranchBody.partial(),
      handler: async ({ ctx, params, body }) => {
        const tenantId = requireTenant(ctx);
        const before = await BranchModel.findOne({ _id: params.id, tenantId }).lean();
        if (!before) throw AppError.notFound('Branch');
        const after = await BranchModel.findOneAndUpdate({ _id: params.id, tenantId }, { $set: body }, { new: true, runValidators: true });
        await recordAudit({ ...fromContext(ctx), action: 'branch.updated', entityType: 'Branch', entityId: params.id, branchId: before._id, changes: diff(before as never, body as never, Object.keys(body)) });
        return after!.toJSON();
      },
    }),
  ]);
  return router;
}
