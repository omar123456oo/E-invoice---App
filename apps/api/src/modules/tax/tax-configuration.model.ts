import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, decimalField, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

/**
 * Versioned tax rule. A rule is never edited after creation: a change in rate
 * creates a new version with a new effectiveFrom, and the previous version is
 * closed with effectiveTo. Issued receipts snapshot the version they used.
 *
 * Only treatments whose calculation has been verified are accepted by the
 * calculation engine (see SUPPORTED_TREATMENTS in calculation.ts).
 */
const TaxConfigurationSchema = new Schema(
  {
    tenantId: tenantIdField,
    code: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9_]{2,40}$/ },
    version: { type: Number, required: true, min: 1 },
    name: { type: String, required: true, maxlength: 120 },
    // ETA code list values (sdk.invoicing.eta.gov.eg/codes/tax-types/).
    etaTaxType: { type: String, required: true, maxlength: 30 },
    etaSubType: { type: String, required: true, maxlength: 50 },
    treatment: { type: String, enum: ['PERCENTAGE', 'EXEMPT'], required: true },
    rate: decimalField(true),
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    verification: {
      source: { type: String, required: true, maxlength: 500 },
      verifiedBy: { type: String, required: true, maxlength: 200 },
      verifiedAt: { type: Date, required: true },
      notes: { type: String, maxlength: 2000, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  baseSchemaOptions,
);
TaxConfigurationSchema.index({ tenantId: 1, code: 1, version: 1 }, { unique: true });
TaxConfigurationSchema.index({ tenantId: 1, code: 1, effectiveFrom: -1 });
tenantScoped(TaxConfigurationSchema);

for (const op of ['deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  TaxConfigurationSchema.pre(op, () => {
    throw new Error('Tax configuration versions cannot be deleted');
  });
}

export type TaxConfiguration = InferSchemaType<typeof TaxConfigurationSchema>;
export const TaxConfigurationModel = model('TaxConfiguration', TaxConfigurationSchema, 'taxConfigurations');
