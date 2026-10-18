import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors/app-error.js';
import { DECIMAL_STRING_RE } from '../../common/money/decimal.js';
import { PaginationQuery, skipOf, toPage } from '../../common/http/pagination.js';
import { mount, ObjectIdParam, route } from '../../common/http/route.js';
import { requireTenant } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { DocumentUploadModel, ImportJobModel, ImportRowModel, UPLOAD_PURPOSES } from './import.model.js';
import { commitProductImport, importDeps, productTemplateCsv, rejectImport, retryImport, reviewDocument, uploadFile } from './import.service.js';

const amount = z.string().regex(DECIMAL_STRING_RE);

export function importRouter(): Router {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env().MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 } }).single('file');
  mount(router, '/imports', [
    route({
      method: 'get', path: '/templates/products.csv', tag: 'Imports', permission: 'imports:read', summary: 'Download the product import template',
      handler: async ({ res }) => {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="products-template.csv"');
        res.send(productTemplateCsv());
        return undefined;
      },
    }),
    route({
      method: 'post', path: '/uploads', tag: 'Imports', status: 201, permission: 'imports:manage',
      summary: 'Upload a file (CSV/XLSX product import; PDF/JPG/PNG documents). Checked by content, scanned, de-duplicated by SHA-256',
      middlewares: [upload], multipart: { file: { type: 'binary' }, purpose: { type: 'string', description: UPLOAD_PURPOSES.join(' | ') } },
      body: z.object({ purpose: z.enum(UPLOAD_PURPOSES) }),
      handler: async ({ ctx, body, req }) => uploadFile(ctx, req.file, body.purpose),
    }),
    route({
      method: 'get', path: '', tag: 'Imports', permission: 'imports:read', summary: 'Import history',
      query: PaginationQuery.extend({ status: z.string().max(20).optional() }),
      handler: async ({ ctx, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx) };
        if (query.status) filter.status = query.status;
        const [jobs, total] = await Promise.all([ImportJobModel.find(filter).sort({ createdAt: -1 }).skip(skipOf(query)).limit(query.pageSize).lean(), ImportJobModel.countDocuments(filter)]);
        const uploads = await DocumentUploadModel.find({ tenantId: requireTenant(ctx), _id: { $in: jobs.map((j) => j.uploadId) } }, { originalName: 1, kind: 1, size: 1, scan: 1 }).lean();
        const byId = new Map(uploads.map((u) => [String(u._id), u]));
        return toPage(jobs.map((j) => {
          const u = byId.get(String(j.uploadId));
          return { ...new ImportJobModel(j).toJSON(), upload: u ? { originalName: u.originalName, kind: u.kind, size: u.size, scan: u.scan?.status } : null };
        }), total, query);
      },
    }),
    route({
      method: 'get', path: '/:id', tag: 'Imports', permission: 'imports:read', summary: 'Import detail', params: ObjectIdParam,
      handler: async ({ ctx, params }) => {
        const tenantId = requireTenant(ctx);
        const job = await ImportJobModel.findOne({ tenantId, _id: params.id });
        if (!job) throw AppError.notFound('Import');
        const up = await DocumentUploadModel.findOne({ tenantId, _id: job.uploadId });
        return { ...job.toJSON(), upload: up?.toJSON() ?? null, extractor: importDeps().extractor.name };
      },
    }),
    route({
      method: 'get', path: '/:id/rows', tag: 'Imports', permission: 'imports:read', summary: 'Parsed rows with row-level errors',
      params: ObjectIdParam, query: PaginationQuery.extend({ invalidOnly: z.enum(['true', 'false']).optional() }),
      handler: async ({ ctx, params, query }) => {
        const filter: Record<string, unknown> = { tenantId: requireTenant(ctx), jobId: params.id };
        if (query.invalidOnly === 'true') filter.valid = false;
        const [items, total] = await Promise.all([ImportRowModel.find(filter).sort({ rowNo: 1 }).skip(skipOf(query)).limit(query.pageSize), ImportRowModel.countDocuments(filter)]);
        return toPage(items.map((r) => r.toJSON()), total, query);
      },
    }),
    route({
      method: 'post', path: '/:id/commit', tag: 'Imports', permission: 'products:manage', summary: 'Import the valid rows of a product import',
      params: ObjectIdParam, body: z.object({ allowPartial: z.boolean().default(false) }),
      handler: async ({ ctx, params, body }) => commitProductImport(ctx, params.id, body.allowPartial),
    }),
    route({
      method: 'post', path: '/:id/review', tag: 'Imports', permission: 'imports:manage',
      summary: 'Record the human review of an uploaded document (totals recalculated; never creates a tax receipt)',
      params: ObjectIdParam,
      body: z.object({
        documentNumber: z.string().min(1).max(100), issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sellerName: z.string().min(1).max(200),
        sellerTaxId: z.string().max(30).optional(), buyerName: z.string().max(200).optional(), buyerTaxId: z.string().max(30).optional(),
        currency: z.string().regex(/^[A-Z]{3}$/).default('EGP'),
        lines: z.array(z.object({ description: z.string().min(1).max(500), quantity: amount, unitPrice: amount, discount: amount.optional(), taxAmount: amount.optional() })).min(1).max(300),
        statedTotals: z.object({ net: amount.optional(), tax: amount.optional(), total: amount }),
        acceptDifferences: z.boolean().optional(), notes: z.string().max(1000).optional(),
      }),
      handler: async ({ ctx, params, body }) => reviewDocument(ctx, params.id, body),
    }),
    route({ method: 'post', path: '/:id/retry', tag: 'Imports', permission: 'imports:manage', summary: 'Retry a failed import', params: ObjectIdParam, handler: async ({ ctx, params }) => retryImport(ctx, params.id) }),
    route({
      method: 'post', path: '/:id/reject', tag: 'Imports', permission: 'imports:manage', summary: 'Discard an import',
      params: ObjectIdParam, body: z.object({ reason: z.string().min(3).max(500) }),
      handler: async ({ ctx, params, body }) => rejectImport(ctx, params.id, body.reason),
    }),
    route({
      method: 'get', path: '/uploads/:id/file', tag: 'Imports', permission: 'imports:read', summary: 'Download the original uploaded file', params: ObjectIdParam,
      handler: async ({ ctx, params, res }) => {
        const up = await DocumentUploadModel.findOne({ tenantId: requireTenant(ctx), _id: params.id }).lean();
        if (!up) throw AppError.notFound('Upload');
        const data = await importDeps().storage.get(up.storageKey);
        await recordAudit({ ...fromContext(ctx), action: 'import.file_downloaded', entityType: 'DocumentUpload', entityId: up._id });
        res.setHeader('Content-Type', up.mime);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(up.originalName)}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(data);
        return undefined;
      },
    }),
  ]);
  return router;
}
