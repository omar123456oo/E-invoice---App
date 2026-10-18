import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, decimalField } from '../../common/db/schema-helpers.js';

export const ETA_ONBOARDING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'PREPROD_TESTING', 'PREPROD_PASSED', 'PRODUCTION_AUTHORIZED'] as const;

/** Internal payment methods offered at the POS and the ETA code each maps to. */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'WALLET', 'VOUCHER', 'GIFT_CARD', 'POINTS', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** A company (tenant) on the platform. Global platform settings live in systemSettings, not here. */
const TenantSchema = new Schema(
  {
    legalName: { type: String, required: true, trim: true, maxlength: 200 },
    tradeName: { type: String, required: true, trim: true, maxlength: 200 },
    // ETA "rin" (registration number), String(30).
    taxRegistrationNumber: { type: String, required: true, trim: true, maxlength: 30 },
    // Default ETA activity code (String(10)) unless a branch overrides it.
    activityCode: { type: String, required: true, trim: true, maxlength: 10 },
    commercialRegistrationNumber: { type: String, trim: true, maxlength: 50, default: null },
    contact: {
      email: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
      phone: { type: String, trim: true, maxlength: 30, default: null },
    },
    status: { type: String, enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE' },
    settings: {
      currency: { type: String, default: 'EGP', match: /^[A-Z]{3}$/ },
      timezone: { type: String, default: 'Africa/Cairo' },
      enabledPaymentMethods: { type: [String], enum: PAYMENT_METHODS, default: ['CASH', 'CARD'] },
      /** Card payments: external terminal confirmations are recorded with an authorization reference. */
      requireCardAuthorizationRef: { type: Boolean, default: true },
      // ETA receipt v1.2 doc: buyer id/name mandatory for type P at or above this total (150,000 EGP at review date).
      buyerIdentityThreshold: { ...decimalField(true), default: () => '150000' },
      // ETA Receipt Issuance FAQ: return receipt within 540 days of the sale (at review date).
      returnWindowDays: { type: Number, default: 540, min: 0, max: 540 },
      // Returns above this amount (or older than approvalAfterDays) require returns:approve.
      returnApprovalAmount: { ...decimalField(true), default: () => '5000' },
      returnApprovalAfterDays: { type: Number, default: 30 },
      maxCashierDiscountPercent: { ...decimalField(true), default: () => '10' },
      // Send warning/critical alerts by email in addition to in-app notifications.
      emailAlerts: { type: Boolean, default: false },
    },
    eta: {
      onboardingStatus: { type: String, enum: ETA_ONBOARDING_STATUSES, default: 'NOT_STARTED' },
      // Confirmed by an administrator from the ETA portal: taxpayer has the B2C tag required for receipt submission.
      b2cTagConfirmed: { type: Boolean, default: false },
      submissionEnabled: { type: Boolean, default: false },
      notes: { type: String, maxlength: 2000, default: null },
    },
  },
  baseSchemaOptions,
);
TenantSchema.index({ taxRegistrationNumber: 1 }, { unique: true });

export type Tenant = InferSchemaType<typeof TenantSchema>;
export const TenantModel = model('Tenant', TenantSchema, 'tenants');
