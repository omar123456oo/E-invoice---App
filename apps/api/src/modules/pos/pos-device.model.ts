import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, branchIdField, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

/**
 * A POS device registered with ETA. Each device owns its own receipt chain:
 * every receipt's previousUUID is the UUID of the previous receipt issued by
 * the same device (ETA receipt v1.2 / Receipt Issuance FAQ). `chain` is
 * advanced atomically with compare-and-swap on `chain.seq`.
 */
const PosDeviceSchema = new Schema(
  {
    tenantId: tenantIdField,
    branchId: branchIdField,
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Short code used in internal receipt numbers.
    code: { type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9]{1,10}$/ },
    // ETA posserial (String(100)) / seller.deviceSerialNumber.
    serialNumber: { type: String, required: true, trim: true, maxlength: 100 },
    osVersion: { type: String, required: true, trim: true, maxlength: 50 },
    modelFramework: { type: String, required: true, trim: true, maxlength: 10 },
    status: { type: String, enum: ['PENDING_ACTIVATION', 'ACTIVE', 'DEACTIVATED'], default: 'PENDING_ACTIVATION' },
    // AES-GCM envelope of { clientId, clientSecret, presharedKey }. Never returned by the API.
    etaCredentialsEnc: { type: String, default: null, select: false },
    etaCredentialsUpdatedAt: { type: Date, default: null },
    chain: {
      seq: { type: Number, default: 0 },
      lastUuid: { type: String, default: '' },
      lastIssuedAt: { type: Date, default: null },
    },
    // Lease held by the worker currently submitting this device's queue (one submitter per chain).
    etaLock: {
      owner: { type: String, default: null },
      until: { type: Date, default: null },
    },
    // Last ETA general notification for this device (credential/date expiry, deactivation).
    lastEtaNotice: { type: String, default: null, maxlength: 500 },
  },
  baseSchemaOptions,
);
PosDeviceSchema.index({ tenantId: 1, serialNumber: 1 }, { unique: true });
PosDeviceSchema.index({ tenantId: 1, branchId: 1, code: 1 }, { unique: true });
tenantScoped(PosDeviceSchema);

export type PosDevice = InferSchemaType<typeof PosDeviceSchema>;
export const PosDeviceModel = model('PosDevice', PosDeviceSchema, 'posDevices');
