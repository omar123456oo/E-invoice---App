import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, decimalField, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

/**
 * Product or service. `internalCode` is the merchant's own code; the official
 * classification is `etaItemType` (GS1 or EGS) + `etaItemCode`, which must be
 * registered/approved through ETA code management. An internal code is never
 * assumed to be an accepted official classification.
 */
const ProductSchema = new Schema(
  {
    tenantId: tenantIdField,
    kind: { type: String, enum: ['GOODS', 'SERVICE'], required: true },
    internalCode: { type: String, required: true, trim: true, maxlength: 50 },
    barcode: { type: String, trim: true, maxlength: 64, default: null },
    nameAr: { type: String, required: true, trim: true, maxlength: 200 },
    nameEn: { type: String, trim: true, maxlength: 200, default: null },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    etaItemType: { type: String, enum: ['GS1', 'EGS'], required: true },
    etaItemCode: { type: String, required: true, trim: true, maxlength: 100 },
    // Set by an administrator once the code is confirmed as approved in ETA code management.
    etaCodeStatus: { type: String, enum: ['UNVERIFIED', 'APPROVED', 'REJECTED'], default: 'UNVERIFIED' },
    // ETA unit type code (codes/unit-types).
    unitType: { type: String, required: true, trim: true, maxlength: 30 },
    unitPrice: decimalField(true),
    taxCodes: { type: [String], required: true, validate: [(v: string[]) => v.length > 0 && v.length <= 5, 'Between 1 and 5 tax codes'] },
    isActive: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);
ProductSchema.index({ tenantId: 1, internalCode: 1 }, { unique: true });
ProductSchema.index({ tenantId: 1, barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } });
ProductSchema.index({ tenantId: 1, isActive: 1, nameAr: 1 });
ProductSchema.index({ tenantId: 1, nameEn: 1 });
tenantScoped(ProductSchema);

export type Product = InferSchemaType<typeof ProductSchema>;
export const ProductModel = model('Product', ProductSchema, 'products');
