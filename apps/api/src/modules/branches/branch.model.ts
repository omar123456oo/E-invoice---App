import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

/** Branch address mirrors the ETA receipt v1.2 seller.branchAddress structure and limits. */
export const BranchAddressSchema = new Schema(
  {
    country: { type: String, required: true, default: 'EG', match: /^[A-Z]{2}$/ },
    governate: { type: String, required: true, maxlength: 100 },
    regionCity: { type: String, required: true, maxlength: 100 },
    street: { type: String, required: true, maxlength: 200 },
    buildingNumber: { type: String, required: true, maxlength: 100 },
    postalCode: { type: String, maxlength: 30, default: null },
    floor: { type: String, maxlength: 100, default: null },
    room: { type: String, maxlength: 100, default: null },
    landmark: { type: String, maxlength: 500, default: null },
    additionalInformation: { type: String, maxlength: 500, default: null },
  },
  { _id: false },
);

const BranchSchema = new Schema(
  {
    tenantId: tenantIdField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Branch code as registered with ETA (seller.branchCode, String(50)).
    etaBranchCode: { type: String, required: true, trim: true, maxlength: 50 },
    activityCode: { type: String, trim: true, maxlength: 10, default: null },
    address: { type: BranchAddressSchema, required: true },
    phone: { type: String, maxlength: 30, default: null },
    isActive: { type: Boolean, default: true },
  },
  baseSchemaOptions,
);
BranchSchema.index({ tenantId: 1, etaBranchCode: 1 }, { unique: true });
tenantScoped(BranchSchema);

export type Branch = InferSchemaType<typeof BranchSchema>;
export const BranchModel = model('Branch', BranchSchema, 'branches');
