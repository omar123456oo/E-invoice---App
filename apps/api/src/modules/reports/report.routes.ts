import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { mount, objectIdString, route } from '../../common/http/route.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { dashboard, etaProcessingReport, refundsReport, salesByCashier, salesByProduct, shiftReconciliation, taxSummary, toCsv, toXlsx } from './report.service.js';

const RangeQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  branchId: objectIdString.optional(),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
}).refine((q) => q.to > q.from, 'to must be after from').refine((q) => q.to.getTime() - q.from.getTime() <= 366 * 86_400_000, 'Range cannot exceed 366 days');

export function reportRouter(): Router {
  const router = Router();
  mount(router, '/reports', [
    route({ method: 'get', path: '/dashboard', tag: 'Reports', permission: 'reports:read', summary: 'Dashboard figures for a period', query: RangeQuery, handler: async ({ ctx, query }) => dashboard(ctx, query) }),
    ...([['sales-by-product', salesByProduct], ['sales-by-cashier', salesByCashier], ['tax-summary', taxSummary], ['refunds', refundsReport], ['eta-processing', etaProcessingReport], ['shift-reconciliation', shiftReconciliation]] as const).map(([name, fn]) =>
      route({
        method: 'get', path: `/${name}`, tag: 'Reports', permission: 'reports:read', summary: `Operational report: ${name} (json, csv or xlsx). Not an official tax return.`, query: RangeQuery,
        handler: async ({ ctx, query, res }) => {
          const rows = await fn(ctx, query);
          if (query.format !== 'json') {
            if (rows.length > 50_000) throw AppError.businessRule('Too many rows; narrow the range', 'EXPORT_TOO_LARGE');
            await recordAudit({ ...fromContext(ctx), action: 'report.exported', entityType: 'Report', entityId: name, changes: { from: query.from, to: query.to, rows: rows.length, format: query.format } });
            if (query.format === 'csv') {
              res.setHeader('Content-Type', 'text/csv; charset=utf-8');
              res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
              res.send(toCsv(rows as never));
            } else {
              res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
              res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
              res.send(await toXlsx(rows as never, name));
            }
            return undefined;
          }
          return { items: rows };
        },
      }),
    ),
  ]);
  return router;
}
