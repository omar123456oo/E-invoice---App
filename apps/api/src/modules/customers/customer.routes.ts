import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { escapeRegex, PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, ObjectIdParam, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { CustomerModel } from './customer.model.js';
import { identityHash, protectIdentity, validateIdentity } from './customer.service.js';

const CustomerBody = z.object({
  buyerType: z.enum(['P', 'B', 'F']),
  name: z.string().min(1).max(100).nullable().optional(),
  identity: z.string().min(1).max(40).optional(),
  mobileNumber: z.string().regex(/^\+?[0-9]{6,20}$/).nullable().optional(),
  email: z.email().nullable().optional(),
  marketingConsent: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export function customerRouter(): Router {
  const router = Router();
  mount(router, '/customers', [
    route({
      method: 'get', path: '', tag: 'Customers', permission: 'customers:read', summary: 'Search customers by name, mobile or exact identity number',
      query: PaginationQuery.extend({ q: z.string().max(100).optional(), identity: z.string().max(40).optional() }),
      handler: async ({ ctx, query }) => {
        const tenantId = requireTenant(ctx);
        const filter: Record<string, unknown> = { tenantId, anonymizedAt: null };
        if (query.identity) filter.identityHash = identityHash(tenantId, query.identity);
        else if (query.q) {
          const rx = new RegExp(escapeRegex(query.q), 'i');
          filter.$or = [{ name: rx }, { mobileNumber: rx }];
        }
        const [items, total] = await Promise.all([
          CustomerModel.find(filter).sort({ updatedAt: -1 }).skip(skipOf(query)).limit(query.pageSize),
          CustomerModel.countDocuments(filter),
        ]);
        return toPage(items.map((c) => c.toJSON()), total, query);
      },
    }),
    route({
      method: 'post', path: '', tag: 'Customers', status: 201, permission: 'customers:manage',
      summary: 'Create a customer profile (detects duplicates by identity number and mobile)', body: CustomerBody,
      handler: async ({ ctx, body }) => {
        const tenantId = requireTenant(ctx);
        if (body.buyerType !== 'P' && (!body.identity || !body.name)) {
          throw AppError.validation([{ path: 'body', message: 'Business and foreign buyers require an identity number and a name' }]);
        }
        let protectedId = {};
        if (body.identity) {
          validateIdentity(body.buyerType, body.identity);
          protectedId = protectIdentity(tenantId, body.identity);
          const dup = await CustomerModel.findOne({ tenantId, identityHash: (protectedId as { identityHash: string }).identityHash });
          if (dup) throw new AppError(409, 'DUPLICATE_CUSTOMER', 'A customer with this identity number already exists', [{ message: String(dup._id), code: 'existingId' }]);
        }
        const possibleDuplicates = body.mobileNumber ? await CustomerModel.find({ tenantId, mobileNumber: body.mobileNumber, anonymizedAt: null }).limit(5) : [];
        const c = await CustomerModel.create({ ...body, identity: undefined, ...protectedId, tenantId });
        await recordAudit({ ...fromContext(ctx), action: 'customer.created', entityType: 'Customer', entityId: c._id, summary: `buyerType=${body.buyerType}` });
        return { customer: c.toJSON(), possibleDuplicates: possibleDuplicates.map((d) => ({ id: String(d._id), name: d.name })) };
      },
    }),
    route({
      method: 'post', path: '/:id/anonymize', tag: 'Customers', permission: 'customers:manage',
      summary: 'Erase personal data from a profile (issued receipts keep their legally required snapshot)', params: ObjectIdParam,
      handler: async ({ ctx, params }) => {
        const res = await CustomerModel.updateOne(
          { _id: params.id, tenantId: requireTenant(ctx), anonymizedAt: null },
          { $set: { name: null, mobileNumber: null, email: null, notes: null, identityEnc: null, identityHash: null, identityLast4: null, marketingConsent: false, anonymizedAt: new Date() } },
        );
        if (res.matchedCount === 0) throw AppError.notFound('Customer');
        await recordAudit({ ...fromContext(ctx), action: 'customer.anonymized', entityType: 'Customer', entityId: params.id });
        return undefined;
      },
    }),
  ]);
  return router;
}
