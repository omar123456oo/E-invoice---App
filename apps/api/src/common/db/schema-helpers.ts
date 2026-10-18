import { Schema, Types, type SchemaOptions } from 'mongoose';
import { tenantGuardPlugin } from './tenant-guard.js';

/** Converts Decimal128 values (deeply) to strings and normalises ids for JSON output. */
export function toJsonTransform(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
  convertDecimals(ret);
  if (ret._id !== undefined) {
    ret.id = String(ret._id);
    delete ret._id;
  }
  delete ret.__v;
  return ret;
}

function convertDecimals(obj: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Types.Decimal128) obj[k] = v.toString();
    else if (v instanceof Types.ObjectId) obj[k] = v.toHexString();
    else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item instanceof Types.Decimal128) v[i] = item.toString();
        else if (item instanceof Types.ObjectId) v[i] = item.toHexString();
        else if (item && typeof item === 'object' && !(item instanceof Date)) convertDecimals(item as Record<string, unknown>);
      });
    } else if (v && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
      convertDecimals(v as Record<string, unknown>);
    }
  }
}

// `satisfies` (not a type annotation) keeps the literal type so Mongoose can still infer document types.
export const baseSchemaOptions = {
  timestamps: true,
  toJSON: { transform: toJsonTransform as never, versionKey: false },
  toObject: { versionKey: false },
} satisfies SchemaOptions;

/** Monetary/quantity field stored as Decimal128. */
export const decimalField = (required = true) => ({ type: Schema.Types.Decimal128, required });

/** Attaches tenantId (+ optional branchId) and the tenant guard to a schema. */
export function tenantScoped<T>(schema: Schema<T>): Schema<T> {
  schema.plugin(tenantGuardPlugin);
  return schema;
}

export const tenantIdField = { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true } as const;
export const branchIdField = { type: Schema.Types.ObjectId, ref: 'Branch', required: true } as const;
