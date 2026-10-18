import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { mount, ObjectIdParam, objectIdString, route } from '../../common/http/route.js';
import { requireTenant, type RequestContext } from '../../common/security/context.js';
import { ASSIGNABLE_ROLES, ROLES, type Role } from '../../common/security/permissions.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { hashPassword, PasswordSchema } from '../auth/password.js';
import { BranchModel } from '../branches/branch.model.js';
import { UserModel } from './user.model.js';

function assertCanAssign(ctx: RequestContext, role: Role): void {
  if (!ASSIGNABLE_ROLES[ctx.role].includes(role)) throw AppError.forbidden(`You cannot assign the role ${role}`, 'ROLE_NOT_ASSIGNABLE');
}

async function assertBranchesBelong(tenantId: Types.ObjectId, branchIds: string[]): Promise<void> {
  if (branchIds.length === 0) return;
  const count = await BranchModel.countDocuments({ tenantId, _id: { $in: branchIds } });
  if (count !== new Set(branchIds).size) throw AppError.validation([{ path: 'body.branchIds', message: 'Unknown branch' }]);
}

export function userRouter(): Router {
  const router = Router();
  mount(router, '/users', [
    route({
      method: 'get', path: '', tag: 'Users', permission: 'users:read', summary: 'List company users',
      handler: async ({ ctx }) => (await UserModel.find({ tenantId: requireTenant(ctx) }).sort({ name: 1 })).map((u) => u.toJSON()),
    }),
    route({
      method: 'post', path: '', tag: 'Users', status: 201, permission: 'users:manage', summary: 'Create a user',
      body: z.object({
        name: z.string().min(2).max(120), email: z.email(), password: PasswordSchema,
        role: z.enum(ROLES), branchIds: z.array(objectIdString).max(200).default([]), locale: z.enum(['ar', 'en']).default('ar'),
      }),
      handler: async ({ ctx, body }) => {
        const tenantId = requireTenant(ctx);
        assertCanAssign(ctx, body.role);
        await assertBranchesBelong(tenantId, body.branchIds);
        const user = await UserModel.create({ ...body, password: undefined, passwordHash: await hashPassword(body.password), tenantId });
        await recordAudit({ ...fromContext(ctx), action: 'user.created', entityType: 'User', entityId: user._id, changes: { email: body.email, role: body.role, branchIds: body.branchIds } });
        return user.toJSON();
      },
    }),
    route({
      method: 'patch', path: '/:id', tag: 'Users', permission: 'users:manage', summary: 'Update role, branches, activation',
      params: ObjectIdParam,
      body: z.object({ name: z.string().min(2).max(120).optional(), role: z.enum(ROLES).optional(), branchIds: z.array(objectIdString).max(200).optional(), isActive: z.boolean().optional() }),
      handler: async ({ ctx, params, body }) => {
        const tenantId = requireTenant(ctx);
        if (params.id === String(ctx.userId)) throw AppError.businessRule('You cannot change your own role or status', 'SELF_MODIFICATION');
        const user = await UserModel.findOne({ _id: params.id, tenantId });
        if (!user) throw AppError.notFound('User');
        // A manager may only modify users whose current role they could have assigned.
        assertCanAssign(ctx, user.role as Role);
        if (body.role) assertCanAssign(ctx, body.role);
        if (body.branchIds) await assertBranchesBelong(tenantId, body.branchIds);
        const changes = { role: body.role, branchIds: body.branchIds, isActive: body.isActive, name: body.name };
        Object.assign(user, Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)));
        await user.save();
        if (body.isActive === false || body.role) await revokeAllSessions(user._id, body.isActive === false ? 'deactivated' : 'role_changed');
        await recordAudit({ ...fromContext(ctx), action: 'user.updated', entityType: 'User', entityId: user._id, changes });
        return user.toJSON();
      },
    }),
    route({
      method: 'post', path: '/:id/revoke-sessions', tag: 'Users', permission: 'users:manage', summary: 'Sign a user out everywhere',
      params: ObjectIdParam,
      handler: async ({ ctx, params }) => {
        const user = await UserModel.findOne({ _id: params.id, tenantId: requireTenant(ctx) });
        if (!user) throw AppError.notFound('User');
        const revoked = await revokeAllSessions(user._id, 'admin_revoked');
        await recordAudit({ ...fromContext(ctx), action: 'user.sessions_revoked', entityType: 'User', entityId: user._id, changes: { revoked } });
        return { revoked };
      },
    }),
  ]);
  return router;
}
