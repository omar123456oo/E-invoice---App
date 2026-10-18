import { Router } from 'express';
import type { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { diff } from '../../common/db/diff.js';
import { escapeRegex, PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, ObjectIdParam, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { TaxConfigurationModel } from '../tax/tax-configuration.model.js';
import { ProductModel } from './product.model.js';
import { validateProductRows } from './product-import.js';
import { ProductBody } from './product.schema.js';

export { ProductBody };

const SENSITIVE_FIELDS = ['unitPrice', 'taxCodes', 'etaItemType', 'etaItemCode', 'unitType', 'isActive', 'etaCodeStatus'];

async function unknownTaxCodes(tenantId: Types.ObjectId, codes: string[]): Promise<string[]> {
  const known: string[] = await TaxConfigurationModel.distinct('code', { tenantId, code: { $in: codes } });
  return codes.filter((c) => !known.includes(c));
}

export function productRouter(): Router {
  const router = Router();
  mount(router, '/products', [
    route({
      method: 'get', path: '', tag: 'Products', permission: 'products:read', summary: 'Search products',
      query: PaginationQuery.extend({ q: z.string().max(100).optional(), active: z.enum(['true', 'false']).optional() }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx) };
        if (query.active) filter.isActive = query.active === 'true';
        if (query.q) {
          const rx = new RegExp(escapeRegex(query.q), 'i');
          filter.$or = [{ nameAr: rx }, { nameEn: rx }, { internalCode: rx }, { barcode: query.q }];
        }
        const [items, total] = await Promise.all([
          ProductModel.find(filter).sort({ nameAr: 1 }).skip(skipOf(query)).limit(query.pageSize),
          ProductModel.countDocuments(filter),
        ]);
        return toPage(items.map((p) => p.toJSON()), total, query);
      },
    }),
    route({
      method: 'get', path: '/barcode/:barcode', tag: 'Products', permission: 'products:read', summary: 'Look up an active product by barcode',
      params: z.object({ barcode: z.string().regex(/^[0-9A-Za-z-]{4,64}$/) }),
      handler: async ({ ctx, params }) => {
        const p = await ProductModel.findOne({ tenantId: requireTenant(ctx), barcode: params.barcode, isActive: true });
        if (!p) throw AppError.notFound('Product');
        return p.toJSON();
      },
    }),
    route({
      method: 'get', path: '/:id', tag: 'Products', permission: 'products:read', summary: 'Get a product', params: ObjectIdParam,
      handler: async ({ ctx, params }) => {
        const p = await ProductModel.findOne({ _id: params.id, tenantId: requireTenant(ctx) });
        if (!p) throw AppError.notFound('Product');
        return p.toJSON();
      },
    }),
    route({
      method: 'post', path: '', tag: 'Products', status: 201, permission: 'products:manage', summary: 'Create a product', body: ProductBody,
      handler: async ({ ctx, body }) => {
        const tenantId = requireTenant(ctx);
        const unknown = await unknownTaxCodes(tenantId, body.taxCodes);
        if (unknown.length) throw AppError.validation([{ path: 'body.taxCodes', message: `Unknown tax codes: ${unknown.join(', ')}` }]);
        const p = await ProductModel.create({ ...body, tenantId });
        await recordAudit({ ...fromContext(ctx), action: 'product.created', entityType: 'Product', entityId: p._id, changes: body });
        return p.toJSON();
      },
    }),
    route({
      method: 'patch', path: '/:id', tag: 'Products', permission: 'products:manage', summary: 'Update a product (price/tax changes are audited)',
      params: ObjectIdParam, body: ProductBody.partial().extend({ etaCodeStatus: z.enum(['UNVERIFIED', 'APPROVED', 'REJECTED']).optional() }),
      handler: async ({ ctx, params, body }) => {
        const tenantId = requireTenant(ctx);
        if (body.taxCodes) {
          const unknown = await unknownTaxCodes(tenantId, body.taxCodes);
          if (unknown.length) throw AppError.validation([{ path: 'body.taxCodes', message: `Unknown tax codes: ${unknown.join(', ')}` }]);
        }
        const before = await ProductModel.findOne({ _id: params.id, tenantId }).lean();
        if (!before) throw AppError.notFound('Product');
        // Changing the official code resets its verification status unless explicitly set.
        const set: Record<string, unknown> = { ...body };
        if ((body.etaItemCode && body.etaItemCode !== before.etaItemCode) || (body.etaItemType && body.etaItemType !== before.etaItemType)) {
          set.etaCodeStatus = body.etaCodeStatus ?? 'UNVERIFIED';
        }
        const after = await ProductModel.findOneAndUpdate({ _id: params.id, tenantId }, { $set: set }, { new: true, runValidators: true });
        const changes = diff(before as never, after!.toObject() as never, SENSITIVE_FIELDS.concat(['nameAr', 'nameEn', 'description', 'barcode']));
        await recordAudit({ ...fromContext(ctx), action: 'product.updated', entityType: 'Product', entityId: params.id, changes });
        return after!.toJSON();
      },
    }),
    route({
      method: 'post', path: '/bulk', tag: 'Products', permission: 'products:manage',
      summary: 'Validate and import products; returns row-level errors (dryRun=true validates only)',
      body: z.object({ dryRun: z.boolean().default(true), rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000) }),
      handler: async ({ ctx, body }) => {
        const tenantId = requireTenant(ctx);
        const { valid: insertable, errors } = await validateProductRows(tenantId, body.rows);
        let inserted = 0;
        if (!body.dryRun && errors.length === 0) {
          await ProductModel.insertMany(insertable.map((v) => ({ ...v.data, tenantId })), { ordered: true });
          inserted = insertable.length;
          await recordAudit({ ...fromContext(ctx), action: 'product.bulk_imported', entityType: 'Product', changes: { count: inserted } });
        }
        return { dryRun: body.dryRun, totalRows: body.rows.length, validRows: insertable.length, inserted, errors };
      },
    }),
  ]);
  return router;
}
