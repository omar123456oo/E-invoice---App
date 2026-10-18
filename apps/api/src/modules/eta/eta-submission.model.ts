import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

/**
 * One HTTP submission attempt to ETA (POST /api/v1/receiptsubmissions).
 * Kept as an append-mostly record of what was sent, when, and what came back.
 * Credentials and tokens are never stored here.
 */
const EtaSubmissionSchema = new Schema(
  {
    tenantId: tenantIdField,
    deviceId: { type: Schema.Types.ObjectId, ref: 'PosDevice', required: true },
    environment: { type: String, enum: ['preprod', 'production', 'simulated'], required: true },
    receiptIds: { type: [Schema.Types.ObjectId], ref: 'Receipt', required: true, validate: [(v: unknown[]) => v.length >= 1 && v.length <= 500, '1 to 500 receipts'] },
    receiptUuids: { type: [String], required: true },
    status: { type: String, enum: ['SENDING', 'ACCEPTED', 'REJECTED', 'FAILED', 'UNKNOWN', 'RETRY_LATER'], required: true },
    requestHash: { type: String, required: true },
    requestBytes: { type: Number, required: true },
    correlationId: { type: String, required: true },
    submissionUuid: { type: String, default: null },
    httpStatus: { type: Number, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null, maxlength: 2000 },
    acceptedCount: { type: Number, default: 0 },
    rejectedCount: { type: Number, default: 0 },
    retryAfterSeconds: { type: Number, default: null },
    sentAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },
    lastPolledAt: { type: Date, default: null },
    overallStatus: { type: String, default: null },
  },
  baseSchemaOptions,
);
EtaSubmissionSchema.index({ tenantId: 1, sentAt: -1 });
EtaSubmissionSchema.index({ tenantId: 1, submissionUuid: 1 });
EtaSubmissionSchema.index({ tenantId: 1, deviceId: 1, sentAt: -1 });
tenantScoped(EtaSubmissionSchema);

export type EtaSubmission = InferSchemaType<typeof EtaSubmissionSchema>;
export const EtaSubmissionModel = model('EtaSubmission', EtaSubmissionSchema, 'etaSubmissions');
