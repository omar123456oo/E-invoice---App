import { Router } from 'express';
import { z } from 'zod';
import { DECIMAL_STRING_RE } from '../../common/money/decimal.js';
import { mount, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { SUPPORTED_TREATMENTS, POLICY_VERSION } from './calculation.js';
import { TaxConfigurationModel } from './tax-configuration.model.js';
import { createTaxVersion, retireTaxRule } from './tax.service.js';

const code = z.string().regex(/^[A-Z0-9_]{2,40}$/);

export function taxRouter(): Router {
  const router = Router();
  mount(router, '/tax-configurations', [
    route({
      method: 'get', path: '', tag: 'Tax', permission: 'tax:read', summary: 'List tax rule versions',
      query: z.object({ code: code.optional(), activeAt: z.coerce.date().optional() }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx) };
        if (query.code) filter.code = query.code;
        if (query.activeAt) Object.assign(filter, { effectiveFrom: { $lte: query.activeAt }, $or: [{ effectiveTo: null }, { effectiveTo: { $gt: query.activeAt } }] });
        return (await TaxConfigurationModel.find(filter).sort({ code: 1, version: -1 })).map((t) => t.toJSON());
      },
    }),
    route({
      method: 'get', path: '/policy', tag: 'Tax', permission: 'tax:read', summary: 'Calculation policy and supported tax treatments',
      handler: async () => ({ policyVersion: POLICY_VERSION, supportedTreatments: SUPPORTED_TREATMENTS }),
    }),
    route({
      method: 'post', path: '', tag: 'Tax', status: 201, permission: 'tax:manage',
      summary: 'Create a new tax rule version (requires verification source)',
      body: z.object({
        code, name: z.string().min(1).max(120), etaTaxType: z.string().min(1).max(30), etaSubType: z.string().min(1).max(50),
        treatment: z.enum(['PERCENTAGE', 'EXEMPT']), rate: z.string().regex(DECIMAL_STRING_RE), effectiveFrom: z.coerce.date(),
        verification: z.object({ source: z.string().min(5).max(500), verifiedBy: z.string().min(2).max(200), verifiedAt: z.coerce.date(), notes: z.string().max(2000).nullable().optional() }),
      }),
      handler: async ({ ctx, body }) => createTaxVersion(ctx, body),
    }),
    route({
      method: 'post', path: '/:code/retire', tag: 'Tax', permission: 'tax:manage', summary: 'Close the open version of a tax rule',
      params: z.object({ code }), body: z.object({ effectiveTo: z.coerce.date() }),
      handler: async ({ ctx, params, body }) => retireTaxRule(ctx, params.code, body.effectiveTo),
    }),
  ]);
  return router;
}
