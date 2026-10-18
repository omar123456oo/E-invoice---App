import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { withTransaction } from '../../common/db/mongo.js';
import { diff } from '../../common/db/diff.js';
import { DECIMAL_STRING_RE } from '../../common/money/decimal.js';
import { mount, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { hashPassword, PasswordSchema } from '../auth/password.js';
import { UserModel } from '../users/user.model.js';
import { ETA_ONBOARDING_STATUSES, PAYMENT_METHODS, TenantModel } from './tenant.model.js';

const decimalString = z.string().regex(DECIMAL_STRING_RE, 'Must be a decimal string');

const CreateTenantBody = z.object({
  legalName: z.string().min(2).max(200),
  tradeName: z.string().min(2).max(200),
  taxRegistrationNumber: z.string().min(1).max(30),
  activityCode: z.string().min(1).max(10),
  contact: z.object({ email: z.email().optional(), phone: z.string().max(30).optional() }).optional(),
  owner: z.object({ name: z.string().min(2).max(120), email: z.email(), password: PasswordSchema }),
});

const UpdateCompanyBody = z.object({
  legalName: z.string().min(2).max(200).optional(),
  tradeName: z.string().min(2).max(200).optional(),
  activityCode: z.string().min(1).max(10).optional(),
  commercialRegistrationNumber: z.string().max(50).nullable().optional(),
  contact: z.object({ email: z.email().nullable().optional(), phone: z.string().max(30).nullable().optional() }).optional(),
  settings: z
    .object({
      enabledPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).optional(),
      requireCardAuthorizationRef: z.boolean().optional(),
      buyerIdentityThreshold: decimalString.optional(),
      returnWindowDays: z.number().int().min(0).max(540).optional(),
      returnApprovalAmount: decimalString.optional(),
      returnApprovalAfterDays: z.number().int().min(0).max(540).optional(),
      maxCashierDiscountPercent: decimalString.optional(),
      emailAlerts: z.boolean().optional(),
    })
    .optional(),
  eta: z
    .object({
      onboardingStatus: z.enum(ETA_ONBOARDING_STATUSES).optional(),
      b2cTagConfirmed: z.boolean().optional(),
      submissionEnabled: z.boolean().optional(),
      notes: z.string().max(2000).nullable().optional(),
    })
    .optional(),
});

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = v;
  }
  return out;
}

export function tenantRouter(): Router {
  const router = Router();
  mount(router, '/platform/tenants', [
    route({
      method: 'post', path: '', tag: 'Platform', status: 201, permission: 'platform:tenants:manage',
      summary: 'Create a company (tenant) with its owner account', body: CreateTenantBody,
      handler: async ({ ctx, body }) => {
        const passwordHash = await hashPassword(body.owner.password);
        return withTransaction(async (session) => {
          const [tenant] = await TenantModel.create([{ ...body, owner: undefined }], { session });
          await UserModel.create([{ tenantId: tenant!._id, email: body.owner.email, name: body.owner.name, passwordHash, role: 'COMPANY_OWNER' }], { session });
          await recordAudit({ ...fromContext(ctx), tenantId: null, action: 'tenant.created', entityType: 'Tenant', entityId: tenant!._id, summary: body.legalName }, session);
          return tenant!.toJSON();
        });
      },
    }),
    route({
      method: 'get', path: '', tag: 'Platform', permission: 'platform:tenants:manage', summary: 'List companies',
      handler: async () => (await TenantModel.find().sort({ createdAt: -1 }).limit(500)).map((t) => t.toJSON()),
    }),
    route({
      method: 'patch', path: '/:id/status', tag: 'Platform', permission: 'platform:tenants:manage', summary: 'Suspend or reactivate a company',
      params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/) }), body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }),
      handler: async ({ ctx, params, body }) => {
        const t = await TenantModel.findByIdAndUpdate(params.id, { $set: { status: body.status } }, { new: true });
        if (!t) throw AppError.notFound('Company');
        await recordAudit({ ...fromContext(ctx), tenantId: null, action: 'tenant.status_changed', entityType: 'Tenant', entityId: t._id, changes: body });
        return t.toJSON();
      },
    }),
  ]);

  mount(router, '/company', [
    route({
      method: 'get', path: '', tag: 'Company', permission: 'company:read', summary: 'Get my company profile and settings',
      handler: async ({ ctx }) => {
        const t = await TenantModel.findById(requireTenant(ctx));
        if (!t) throw AppError.notFound('Company');
        return t.toJSON();
      },
    }),
    route({
      method: 'patch', path: '', tag: 'Company', permission: 'company:manage', summary: 'Update company profile, settings and ETA onboarding status',
      body: UpdateCompanyBody,
      handler: async ({ ctx, body }) => {
        const tenantId = requireTenant(ctx);
        const before = await TenantModel.findById(tenantId).lean();
        if (!before) throw AppError.notFound('Company');
        if (body.eta?.submissionEnabled && !(body.eta.b2cTagConfirmed ?? before.eta?.b2cTagConfirmed)) {
          throw AppError.businessRule('ETA submission requires confirmation that the taxpayer holds the B2C tag', 'B2C_TAG_REQUIRED');
        }
        const set = flatten(body as Record<string, unknown>);
        const after = await TenantModel.findByIdAndUpdate(tenantId, { $set: set }, { new: true, runValidators: true });
        const flatBefore = flatten(before as unknown as Record<string, unknown>);
        await recordAudit({ ...fromContext(ctx), action: 'company.updated', entityType: 'Tenant', entityId: tenantId, changes: diff(flatBefore, set, Object.keys(set)) });
        return after!.toJSON();
      },
    }),
  ]);
  return router;
}

