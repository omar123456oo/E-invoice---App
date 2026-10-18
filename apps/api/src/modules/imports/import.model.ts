import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

export const UPLOAD_PURPOSES = ['PRODUCT_IMPORT', 'SUPPLIER_INVOICE', 'EXISTING_OFFICIAL_RECEIPT', 'EXTERNAL_DOCUMENT'] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** A stored upload. The file itself lives in private storage under `storageKey`. */
const DocumentUploadSchema = new Schema(
  {
    tenantId: tenantIdField,
    purpose: { type: String, enum: UPLOAD_PURPOSES, required: true },
    originalName: { type: String, required: true, maxlength: 255 },
    kind: { type: String, enum: ['pdf', 'jpg', 'png', 'csv', 'xlsx'], required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    storageKey: { type: String, required: true },
    scan: { status: { type: String, enum: ['CLEAN', 'INFECTED', 'NOT_SCANNED', 'ERROR'], required: true }, detail: { type: String, default: null }, at: { type: Date, required: true } },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'ImportJob', default: null },
  },
  baseSchemaOptions,
);
DocumentUploadSchema.index({ tenantId: 1, purpose: 1, sha256: 1 }, { unique: true });
DocumentUploadSchema.index({ tenantId: 1, createdAt: -1 });
tenantScoped(DocumentUploadSchema);
export const DocumentUploadModel = model('DocumentUpload', DocumentUploadSchema, 'documentUploads');

/**
 * Processing of one upload.
 *  PRODUCTS: PENDING → PROCESSING → READY (preview with row errors) → COMMITTED
 *  DOCUMENT: PENDING → PROCESSING → NEEDS_REVIEW → REVIEWED
 *  any: → FAILED (retry → PENDING) | REJECTED (discarded by a user)
 */
const ImportJobSchema = new Schema(
  {
    tenantId: tenantIdField,
    uploadId: { type: Schema.Types.ObjectId, ref: 'DocumentUpload', required: true },
    kind: { type: String, enum: ['PRODUCTS', 'DOCUMENT'], required: true },
    purpose: { type: String, enum: UPLOAD_PURPOSES, required: true },
    status: { type: String, enum: ['PENDING', 'PROCESSING', 'READY', 'COMMITTED', 'NEEDS_REVIEW', 'REVIEWED', 'FAILED', 'REJECTED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    error: { type: String, default: null, maxlength: 1000 },
    counts: { total: { type: Number, default: 0 }, valid: { type: Number, default: 0 }, invalid: { type: Number, default: 0 }, inserted: { type: Number, default: 0 } },
    extraction: { provider: { type: String, default: null }, confidence: { type: Number, default: null }, fields: { type: Schema.Types.Mixed, default: null } },
    review: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    finishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    finishedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
ImportJobSchema.index({ tenantId: 1, createdAt: -1 });
ImportJobSchema.index({ status: 1, updatedAt: 1 });
tenantScoped(ImportJobSchema);
export type ImportJob = InferSchemaType<typeof ImportJobSchema>;
export const ImportJobModel = model('ImportJob', ImportJobSchema, 'importJobs');

/** Parsed rows of a product import, kept outside the job to avoid unbounded arrays. */
const ImportRowSchema = new Schema(
  {
    tenantId: tenantIdField,
    jobId: { type: Schema.Types.ObjectId, ref: 'ImportJob', required: true },
    rowNo: { type: Number, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    issues: [{ _id: false, path: String, message: String }],
    valid: { type: Boolean, required: true },
  },
  baseSchemaOptions,
);
ImportRowSchema.index({ tenantId: 1, jobId: 1, rowNo: 1 }, { unique: true });
ImportRowSchema.index({ tenantId: 1, jobId: 1, valid: 1 });
tenantScoped(ImportRowSchema);
export const ImportRowModel = model('ImportRow', ImportRowSchema, 'importRows');
