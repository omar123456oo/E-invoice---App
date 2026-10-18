import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { mount, objectIdString, route } from '../../common/http/route.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { dashboard, salesByCashier, salesByProduct, toCsv } from './report.service.js';

const RangeQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  branchId: objectIdString.optional(),
  format: z.enum(['json', 'csv']).default('json'),
}).refine((q) => q.to > q.from, 'to must be after from').refine((q) => q.to.getTime() - q.from.getTime() <= 366 * 86_400_000, 'Range cannot exceed 366 days');

export function reportRouter(): Router {
  const router = Router();
  mount(router, '/reports', [
    route({ method: 'get', path: '/dashboard', tag: 'Reports', permission: 'reports:read', summary: 'Dashboard figures for a period', query: RangeQuery, handler: async ({ ctx, query }) => dashboard(ctx, query) }),
    ...([['sales-by-product', salesByProduct], ['sales-by-cashier', salesByCashier]] as const).map(([name, fn]) =>
      route({
        method: 'get', path: `/${name}`, tag: 'Reports', permission: 'reports:read', summary: `Operational report: ${name} (json or csv). Not an official tax return.`, query: RangeQuery,
        handler: async ({ ctx, query, res }) => {
          const rows = await fn(ctx, query);
          if (query.format === 'csv') {
            if (rows.length > 50_000) throw AppError.businessRule('Too many rows; narrow the range', 'EXPORT_TOO_LARGE');
            await recordAudit({ ...fromContext(ctx), action: 'report.exported', entityType: 'Report', entityId: name, changes: { from: query.from, to: query.to, rows: rows.length } });
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
            res.send(toCsv(rows as never));
            return undefined;
          }
          return { items: rows };
        },
      }),
    ),
  ]);
  return router;
}
