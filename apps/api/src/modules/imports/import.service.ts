import ExcelJS from 'exceljs';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { sha256Bytes } from '../../common/crypto/crypto.js';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../common/logging/logger.js';
import { dec, DECIMAL_STRING_RE, Decimal, sum } from '../../common/money/decimal.js';
import { requireTenant, type RequestContext } from '../../common/security/context.js';
import { enqueueSafely, getJobQueue, NoopQueue } from '../../jobs/queue.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { notify } from '../notifications/notification.service.js';
import { normaliseProductRow, PRODUCT_COLUMNS, validateProductRows } from '../products/product-import.js';
import { ProductModel } from '../products/product.model.js';
import { NoExtractor, type DocumentExtractor } from './extractor.js';
import { parseCsv } from './csv.js';
import { detectKind, MIME, type AllowedKind } from './file-check.js';
import { DocumentUploadModel, ImportJobModel, ImportRowModel, type UploadPurpose } from './import.model.js';
import { ClamdScanner, NoScanner, type MalwareScanner } from './scanner.js';
import { LocalFileStorage, type FileStorage } from './storage.js';
import { GridFsStorage } from './gridfs-storage.js';

export const MAX_IMPORT_ROWS = 5000;

const PURPOSE_KINDS: Record<UploadPurpose, AllowedKind[]> = {
  PRODUCT_IMPORT: ['csv', 'xlsx'],
  SUPPLIER_INVOICE: ['pdf', 'jpg', 'png'],
  EXISTING_OFFICIAL_RECEIPT: ['pdf', 'jpg', 'png'],
  EXTERNAL_DOCUMENT: ['pdf', 'jpg', 'png'],
};

interface Deps { storage: FileStorage; scanner: MalwareScanner; extractor: DocumentExtractor }
let deps: Deps | undefined;

function defaults(): Deps {
  const cfg = env();
  const [host, port] = cfg.CLAMAV_ADDRESS.split(':');
  return {
    storage: cfg.STORAGE_DRIVER === 'gridfs' ? new GridFsStorage() : new LocalFileStorage(cfg.STORAGE_DIR),
    scanner: host ? new ClamdScanner(host, Number(port ?? 3310)) : new NoScanner(),
    extractor: new NoExtractor(),
  };
}
export const importDeps = (): Deps => (deps ??= defaults());
export const setImportDeps = (d: Partial<Deps>): void => {
  deps = { ...importDeps(), ...d };
};

export async function uploadFile(ctx: RequestContext, file: { buffer: Buffer; originalname: string } | undefined, purpose: UploadPurpose) {
  const tenantId = requireTenant(ctx);
  if (!file) throw AppError.validation([{ path: 'file', message: 'A file is required' }]);
  const max = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.buffer.length === 0) throw AppError.validation([{ path: 'file', message: 'The file is empty' }]);
  if (file.buffer.length > max) throw new AppError(413, 'PAYLOAD_TOO_LARGE', `Files are limited to ${env().MAX_UPLOAD_MB} MB`);
  const kind = await detectKind(file.buffer, file.originalname);
  if (!kind || !PURPOSE_KINDS[purpose].includes(kind)) {
    throw AppError.businessRule(`This file type is not accepted for ${purpose}. Allowed: ${PURPOSE_KINDS[purpose].join(', ')}`, 'UNSUPPORTED_FILE_TYPE');
  }
  const sha256 = sha256Bytes(file.buffer);
  const existing = await DocumentUploadModel.findOne({ tenantId, purpose, sha256 });
  if (existing) {
    const job = await ImportJobModel.findOne({ tenantId, _id: existing.jobId });
    return { duplicate: true, upload: existing.toJSON(), job: job?.toJSON() ?? null };
  }

  const d = importDeps();
  const scan = await d.scanner.scan(file.buffer);
  if (scan.status === 'INFECTED') {
    await recordAudit({ ...fromContext(ctx), action: 'import.upload_blocked', outcome: 'failure', summary: `Malware detected: ${scan.detail}`, changes: { originalName: file.originalname, sha256 } });
    throw AppError.businessRule('The file was rejected by the malware scanner', 'MALWARE_DETECTED');
  }
  const storageKey = `${tenantId}/${sha256}.${kind}`;
  await d.storage.put(storageKey, file.buffer);
  const uploadId = new Types.ObjectId();
  const job = await ImportJobModel.create({ tenantId, uploadId, kind: purpose === 'PRODUCT_IMPORT' ? 'PRODUCTS' : 'DOCUMENT', purpose, createdBy: ctx.userId });
  const upload = await DocumentUploadModel.create({
    _id: uploadId, tenantId, purpose, originalName: file.originalname.slice(0, 255).replace(/[\r\n"]/g, '_'), kind, mime: MIME[kind],
    size: file.buffer.length, sha256, storageKey, scan: { ...scan, at: new Date() }, uploadedBy: ctx.userId, jobId: job._id,
  });
  await recordAudit({ ...fromContext(ctx), action: 'import.uploaded', entityType: 'ImportJob', entityId: job._id, changes: { purpose, kind, size: upload.size, sha256, scan: scan.status } });
  await enqueueSafely('import.process', { tenantId: String(tenantId), jobId: String(job._id) }, { jobId: `import:${job._id}` });
  // Without a worker queue (development), process right away instead of waiting for the sweeper.
  if (getJobQueue() instanceof NoopQueue && env().NODE_ENV === 'development') setImmediate(() => void processImportJob(tenantId, job._id));
  return { duplicate: false, upload: upload.toJSON(), job: job.toJSON() };
}

async function readSheet(data: Buffer, kind: AllowedKind): Promise<Array<Record<string, unknown>>> {
  let table: string[][];
  if (kind === 'csv') {
    table = parseCsv(data.toString('utf8'));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as never);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('The workbook has no sheet');
    table = [];
    // cell.text is the displayed text, so codes and barcodes keep leading zeros and prices keep their scale.
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => (cells[col - 1] = String(cell.text ?? '')));
      table.push(Array.from(cells, (c) => c ?? ''));
    });
  }
  const [header, ...body] = table;
  const known = new Map(PRODUCT_COLUMNS.map((c) => [c.toLowerCase(), c]));
  const cols = (header ?? []).map((h) => known.get(h.trim().toLowerCase()));
  if (!cols.includes('internalCode')) throw new Error(`Header row must contain the template columns: ${PRODUCT_COLUMNS.join(', ')}`);
  if (body.length > MAX_IMPORT_ROWS) throw new Error(`Files are limited to ${MAX_IMPORT_ROWS} rows`);
  return body.map((cells) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => c && (obj[c] = cells[i] ?? ''));
    return obj;
  });
}

/** Background processing of one import job. Safe to call repeatedly: only PENDING jobs are claimed. */
export async function processImportJob(tenantId: Types.ObjectId, jobId: Types.ObjectId): Promise<string> {
  const job = await ImportJobModel.findOneAndUpdate({ tenantId, _id: jobId, status: 'PENDING' }, { $set: { status: 'PROCESSING', error: null }, $inc: { attempts: 1 } }, { new: true });
  if (!job) return 'SKIPPED';
  try {
    const upload = await DocumentUploadModel.findOne({ tenantId, _id: job.uploadId }).lean();
    if (!upload) throw new Error('Upload record missing');
    const data = await importDeps().storage.get(upload.storageKey);
    if (job.kind === 'PRODUCTS') {
      const raw = await readSheet(data, upload.kind as AllowedKind);
      const normalised = raw.map(normaliseProductRow);
      const { valid, errors } = await validateProductRows(tenantId, normalised);
      const errByRow = new Map(errors.map((e) => [e.row, e.errors]));
      await ImportRowModel.deleteMany({ tenantId, jobId });
      if (normalised.length) {
        await ImportRowModel.insertMany(normalised.map((d, i) => ({ tenantId, jobId, rowNo: i + 1, data: d, issues: errByRow.get(i + 1) ?? [], valid: !errByRow.has(i + 1) })));
      }
      await ImportJobModel.updateOne({ tenantId, _id: jobId }, { $set: { status: 'READY', counts: { total: normalised.length, valid: valid.length, invalid: normalised.length - valid.length, inserted: 0 } } });
      return 'READY';
    }
    const d = importDeps();
    const extracted = await d.extractor.extract(data, upload.mime);
    await ImportJobModel.updateOne({ tenantId, _id: jobId }, { $set: { status: 'NEEDS_REVIEW', extraction: { provider: d.extractor.name, confidence: extracted.confidence, fields: extracted.fields } } });
    return 'NEEDS_REVIEW';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ jobId: String(jobId), message }, 'Import processing failed');
    await ImportJobModel.updateOne({ tenantId, _id: jobId }, { $set: { status: 'FAILED', error: message.slice(0, 1000) } });
    await notify({
      tenantId, kind: 'IMPORT_FINISHED', severity: 'warning', userIds: [job.createdBy],
      title: { en: 'Import failed', ar: 'فشل الاستيراد' }, body: { en: message.slice(0, 400), ar: message.slice(0, 400) },
      link: `/imports/${jobId}`, dedupeKey: `import-failed:${jobId}:${job.attempts}`,
    });
    return 'FAILED';
  }
}

export async function processPendingImports(limit = 20): Promise<number> {
  const jobs = await ImportJobModel.find({ status: 'PENDING' }, { tenantId: 1 }).setOptions({ skipTenantGuard: true }).sort({ createdAt: 1 }).limit(limit).lean();
  for (const j of jobs) await processImportJob(j.tenantId, j._id);
  return jobs.length;
}

async function loadJob(ctx: RequestContext, jobId: string) {
  const job = await ImportJobModel.findOne({ tenantId: requireTenant(ctx), _id: jobId });
  if (!job) throw AppError.notFound('Import');
  return job;
}

/** Inserts the valid rows of a READY product import. Invalid rows are never imported. */
export async function commitProductImport(ctx: RequestContext, jobId: string, allowPartial: boolean) {
  const tenantId = requireTenant(ctx);
  const job = await loadJob(ctx, jobId);
  if (job.kind !== 'PRODUCTS' || job.status !== 'READY') throw AppError.businessRule(`Import is ${job.status}`, 'INVALID_IMPORT_STATE');
  if (job.counts!.invalid! > 0 && !allowPartial) throw AppError.businessRule('Fix the rows with errors, or confirm importing only the valid rows', 'IMPORT_HAS_ERRORS');
  const claimed = await ImportJobModel.updateOne({ tenantId, _id: job._id, status: 'READY' }, { $set: { status: 'PROCESSING' } });
  if (claimed.modifiedCount !== 1) throw AppError.conflict('Import is being committed', 'CONCURRENT_UPDATE');
  const rows = await ImportRowModel.find({ tenantId, jobId: job._id, valid: true }).sort({ rowNo: 1 }).lean();
  // Re-validate at commit time: products or tax rules may have changed since the preview.
  const { valid } = await validateProductRows(tenantId, rows.map((r) => r.data as Record<string, unknown>));
  let inserted = 0;
  if (valid.length) {
    try {
      const res = await ProductModel.insertMany(valid.map((v) => ({ ...v.data, tenantId })), { ordered: false });
      inserted = res.length;
    } catch (err) {
      inserted = (err as { insertedDocs?: unknown[] }).insertedDocs?.length ?? 0;
    }
  }
  await ImportJobModel.updateOne({ tenantId, _id: job._id }, { $set: { status: 'COMMITTED', 'counts.inserted': inserted, finishedBy: ctx.userId, finishedAt: new Date() } });
  await recordAudit({ ...fromContext(ctx), action: 'import.committed', entityType: 'ImportJob', entityId: job._id, changes: { inserted, skipped: job.counts!.total! - inserted } });
  await notify({
    tenantId, kind: 'IMPORT_FINISHED', severity: 'info', userIds: [job.createdBy],
    title: { en: `Product import finished: ${inserted} added`, ar: `اكتمل استيراد المنتجات: أضيف ${inserted}` },
    body: { en: `${inserted} of ${job.counts!.total} rows imported.`, ar: `تم استيراد ${inserted} من ${job.counts!.total} صف.` },
    link: `/imports/${job._id}`, dedupeKey: `import-done:${job._id}`,
  });
  return (await ImportJobModel.findOne({ tenantId, _id: job._id }))!.toJSON();
}

export interface DocumentReview {
  documentNumber: string;
  issueDate: string;
  sellerName: string;
  sellerTaxId?: string;
  buyerName?: string;
  buyerTaxId?: string;
  currency: string;
  lines: Array<{ description: string; quantity: string; unitPrice: string; discount?: string; taxAmount?: string }>;
  statedTotals: { net?: string; tax?: string; total: string };
  acceptDifferences?: boolean;
  notes?: string;
}

/**
 * Human review of an uploaded document. Totals are recalculated from the
 * reviewed lines; a mismatch with the document's stated totals must be
 * explicitly accepted. Reviewing never creates or submits a tax receipt.
 */
export async function reviewDocument(ctx: RequestContext, jobId: string, review: DocumentReview) {
  const tenantId = requireTenant(ctx);
  const job = await loadJob(ctx, jobId);
  if (job.kind !== 'DOCUMENT' || !['NEEDS_REVIEW', 'REVIEWED'].includes(job.status)) throw AppError.businessRule(`Import is ${job.status}`, 'INVALID_IMPORT_STATE');
  for (const v of [...review.lines.flatMap((l) => [l.quantity, l.unitPrice, l.discount ?? '0', l.taxAmount ?? '0']), review.statedTotals.total, review.statedTotals.net ?? '0', review.statedTotals.tax ?? '0']) {
    if (!DECIMAL_STRING_RE.test(v)) throw AppError.validation([{ path: 'body', message: `Invalid amount: ${v}` }]);
  }
  const lineNet = review.lines.map((l) => dec(l.quantity).times(l.unitPrice).minus(l.discount ?? '0').toDecimalPlaces(2));
  const net = sum(lineNet);
  const tax = sum(review.lines.map((l) => l.taxAmount ?? '0'));
  const total = net.plus(tax);
  const diffs: string[] = [];
  const cmp = (name: string, stated: string | undefined, computed: Decimal) => {
    if (stated !== undefined && !dec(stated).eq(computed)) diffs.push(`${name}: stated ${stated}, computed ${computed.toFixed(2)}`);
  };
  cmp('net', review.statedTotals.net, net);
  cmp('tax', review.statedTotals.tax, tax);
  cmp('total', review.statedTotals.total, total);
  if (diffs.length && !review.acceptDifferences) throw AppError.businessRule('The document totals do not match the reviewed lines', 'TOTALS_MISMATCH', diffs.map((m) => ({ message: m })));
  const record = { ...review, computed: { net: net.toFixed(2), tax: tax.toFixed(2), total: total.toFixed(2) }, differences: diffs, reviewedBy: String(ctx.userId), reviewedAt: new Date() };
  await ImportJobModel.updateOne({ tenantId, _id: job._id }, { $set: { status: 'REVIEWED', review: record, finishedBy: ctx.userId, finishedAt: new Date() } });
  await recordAudit({ ...fromContext(ctx), action: 'import.document_reviewed', entityType: 'ImportJob', entityId: job._id, changes: { documentNumber: review.documentNumber, total: total.toFixed(2), differences: diffs } });
  return (await ImportJobModel.findOne({ tenantId, _id: job._id }))!.toJSON();
}

export async function retryImport(ctx: RequestContext, jobId: string) {
  const tenantId = requireTenant(ctx);
  const res = await ImportJobModel.updateOne({ tenantId, _id: jobId, status: 'FAILED' }, { $set: { status: 'PENDING', error: null } });
  if (res.modifiedCount !== 1) throw AppError.businessRule('Only failed imports can be retried', 'INVALID_IMPORT_STATE');
  await recordAudit({ ...fromContext(ctx), action: 'import.retried', entityType: 'ImportJob', entityId: jobId });
  await enqueueSafely('import.process', { tenantId: String(tenantId), jobId }, { jobId: `import:${jobId}:${Date.now()}` });
  return (await ImportJobModel.findOne({ tenantId, _id: jobId }))!.toJSON();
}

export async function rejectImport(ctx: RequestContext, jobId: string, reason: string) {
  const tenantId = requireTenant(ctx);
  const res = await ImportJobModel.updateOne({ tenantId, _id: jobId, status: { $in: ['READY', 'NEEDS_REVIEW', 'FAILED'] } }, { $set: { status: 'REJECTED', error: reason, finishedBy: ctx.userId, finishedAt: new Date() } });
  if (res.modifiedCount !== 1) throw AppError.businessRule('This import can no longer be discarded', 'INVALID_IMPORT_STATE');
  await recordAudit({ ...fromContext(ctx), action: 'import.rejected', entityType: 'ImportJob', entityId: jobId, summary: reason });
  return undefined;
}

export function productTemplateCsv(): string {
  const example = ['GOODS', 'SKU-001', '6220000000017', 'مياه معدنية', 'Mineral water', 'Mineral water 1.5L', 'EGS', 'EG-000000000-001', 'EA', '10.00', 'VAT_STD'];
  return '﻿' + [PRODUCT_COLUMNS.join(','), example.join(',')].join('\r\n') + '\r\n';
}
