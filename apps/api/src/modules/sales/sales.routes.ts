import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { DECIMAL_STRING_RE } from '../../common/money/decimal.js';
import { PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, ObjectIdParam, objectIdString, route } from '../../common/http/route.js';
import { branchFilter, requireTenant } from '../../common/security/context.js';
import { PAYMENT_METHODS } from '../tenants/tenant.model.js';
import { closeShift, currentShift, expectedCash, openShift } from '../pos/shift.service.js';
import { CashierShiftModel } from '../pos/cashier-shift.model.js';
import { checkout, quote } from './checkout.service.js';
import { SalesTransactionModel } from './sales-transaction.model.js';

const decimal = z.string().regex(DECIMAL_STRING_RE, 'Must be a decimal string');
const Discount = z.object({ rate: decimal.optional(), amount: decimal.optional(), description: z.string().min(1).max(50) }).refine((d) => d.rate || d.amount, 'rate or amount is required');
const CartItem = z.object({ productId: objectIdString, quantity: decimal, discount: Discount.optional() });
export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9-]{16,64}$/, 'Idempotency-Key header must be 16–64 characters [A-Za-z0-9-]');

const CheckoutBody = z.object({
  deviceId: objectIdString,
  items: z.array(CartItem).min(1).max(300),
  extraDiscount: Discount.optional(),
  customerId: objectIdString.optional(),
  buyer: z.object({ type: z.enum(['P', 'B', 'F']), name: z.string().min(1).max(100).optional(), identity: z.string().min(1).max(40).optional(), mobileNumber: z.string().max(30).optional() }).optional(),
  payments: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: decimal, tendered: decimal.optional(), reference: z.string().min(1).max(40).optional() })).min(1).max(10),
});

export function salesRouter(): Router {
  const router = Router();
  mount(router, '/pos', [
    route({ method: 'get', path: '/shifts/current', tag: 'POS', permission: 'pos:shifts:operate', summary: 'My open shift, if any', handler: async ({ ctx }) => ({ shift: await currentShift(ctx) }) }),
    route({
      method: 'post', path: '/shifts', tag: 'POS', status: 201, permission: 'pos:shifts:operate', summary: 'Open a cashier shift on a device',
      body: z.object({ deviceId: objectIdString, openingCash: decimal }),
      handler: async ({ ctx, body }) => openShift(ctx, body.deviceId, body.openingCash),
    }),
    route({
      method: 'post', path: '/shifts/:id/close', tag: 'POS', permission: 'pos:shifts:operate', summary: 'Close a shift with a cash count (computes variance)',
      params: ObjectIdParam, body: z.object({ countedCash: decimal, notes: z.string().max(500).optional() }),
      handler: async ({ ctx, params, body }) => closeShift(ctx, params.id, body.countedCash, body.notes),
    }),
    route({
      method: 'get', path: '/shifts', tag: 'POS', permission: 'payments:read', summary: 'Shift history with reconciliation figures',
      query: PaginationQuery.extend({ branchId: objectIdString.optional(), status: z.enum(['OPEN', 'CLOSED']).optional() }),
      handler: async ({ ctx, query }) => {
        const tenantId = requireTenant(ctx);
        const filter: Record<string, unknown> = { tenantId, ...branchFilter(ctx, query.branchId) };
        if (query.status) filter.status = query.status;
        const [items, total] = await Promise.all([
          CashierShiftModel.find(filter).sort({ openedAt: -1 }).skip(skipOf(query)).limit(query.pageSize),
          CashierShiftModel.countDocuments(filter),
        ]);
        const enriched = await Promise.all(items.map(async (s) => (s.status === 'OPEN' ? { ...s.toJSON(), live: await expectedCash(tenantId, s._id, s.openingCash.toString()) } : s.toJSON())));
        return toPage(enriched, total, query);
      },
    }),
    route({
      method: 'post', path: '/quote', tag: 'POS', permission: 'sales:checkout', summary: 'Price a cart on the server without saving it',
      body: z.object({ items: z.array(CartItem).min(1).max(300), extraDiscount: Discount.optional() }),
      handler: async ({ ctx, body }) => quote(ctx, body.items, body.extraDiscount),
    }),
    route({
      method: 'post', path: '/checkout', tag: 'POS', status: 201, permission: 'sales:checkout',
      summary: 'Complete a sale and issue its receipt (requires Idempotency-Key header)',
      description: 'Totals are calculated on the server. Replaying the same Idempotency-Key returns the original sale instead of creating a duplicate.',
      body: CheckoutBody,
      handler: async ({ ctx, body, req }) => {
        const key = IdempotencyKey.safeParse(req.headers['idempotency-key']);
        if (!key.success) throw AppError.validation([{ path: 'headers.idempotency-key', message: key.error.issues[0]!.message }]);
        return checkout(ctx, body, key.data);
      },
    }),
  ]);
  mount(router, '/sales-transactions', [
    route({
      method: 'get', path: '', tag: 'Sales', permission: 'sales:read', summary: 'List sales transactions',
      query: PaginationQuery.extend({ branchId: objectIdString.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx), ...branchFilter(ctx, query.branchId) };
        if (query.from || query.to) filter.completedAt = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lt: query.to } : {}) };
        const [items, total] = await Promise.all([
          SalesTransactionModel.find(filter).sort({ completedAt: -1 }).skip(skipOf(query)).limit(query.pageSize),
          SalesTransactionModel.countDocuments(filter),
        ]);
        return toPage(items.map((t) => t.toJSON()), total, query);
      },
    }),
  ]);
  return router;
}
