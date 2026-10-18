import { Schema, model, type InferSchemaType } from 'mongoose';
import { baseSchemaOptions, tenantIdField, tenantScoped } from '../../common/db/schema-helpers.js';

const Text = { en: { type: String, required: true, maxlength: 500 }, ar: { type: String, required: true, maxlength: 500 } };

/** One in-app notification per recipient. */
const NotificationSchema = new Schema(
  {
    tenantId: tenantIdField,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, required: true, enum: ['ETA_RECEIPT_PROBLEM', 'ETA_SUBMISSION_WINDOW', 'CASH_VARIANCE', 'IMPORT_FINISHED', 'JOB_FAILED'] },
    severity: { type: String, enum: ['info', 'warning', 'critical'], required: true },
    title: Text,
    body: Text,
    link: { type: String, default: null, maxlength: 200 },
    entityType: { type: String, default: null },
    entityId: { type: String, default: null },
    dedupeKey: { type: String, required: true, maxlength: 200 },
    readAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
NotificationSchema.index({ tenantId: 1, userId: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ tenantId: 1, userId: 1, dedupeKey: 1 }, { unique: true });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });
tenantScoped(NotificationSchema);
export type Notification = InferSchemaType<typeof NotificationSchema>;
export const NotificationModel = model('Notification', NotificationSchema, 'notifications');

/** Durable email outbox. The sweeper sends PENDING messages with retries and backoff. */
const NotificationJobSchema = new Schema(
  {
    tenantId: tenantIdField,
    notificationId: { type: Schema.Types.ObjectId, ref: 'Notification', default: null },
    to: { type: String, required: true, maxlength: 254 },
    subject: { type: String, required: true, maxlength: 300 },
    text: { type: String, required: true, maxlength: 5000 },
    status: { type: String, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null, maxlength: 500 },
    nextAttemptAt: { type: Date, default: () => new Date() },
    sentAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
NotificationJobSchema.index({ status: 1, nextAttemptAt: 1 });
NotificationJobSchema.index({ tenantId: 1, createdAt: -1 });
tenantScoped(NotificationJobSchema);
export const NotificationJobModel = model('NotificationJob', NotificationJobSchema, 'notificationJobs');
