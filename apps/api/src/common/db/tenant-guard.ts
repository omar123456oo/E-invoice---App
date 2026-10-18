import type { Aggregate, Query, Schema } from 'mongoose';

/**
 * Defence-in-depth for multi-tenancy: every query or aggregation on a
 * tenant-scoped collection must constrain tenantId. Services are expected to
 * scope queries themselves; this plugin turns an omission into a loud error
 * instead of a silent cross-tenant data leak.
 *
 * Bypass only for platform-level operations: query.setOptions({ skipTenantGuard: true }).
 */
export class TenantGuardError extends Error {
  constructor(model: string, op: string) {
    super(`Tenant guard: ${op} on ${model} without a tenantId filter`);
    this.name = 'TenantGuardError';
  }
}

const QUERY_OPS = [
  'find',
  'findOne',
  'countDocuments',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
  'replaceOne',
  'distinct',
] as const;

export function tenantGuardPlugin(schema: Schema): void {
  for (const op of QUERY_OPS) {
    schema.pre(op as 'find', function (this: Query<unknown, unknown>) {
      const opts = this.getOptions() as { skipTenantGuard?: boolean };
      if (opts.skipTenantGuard) return;
      const filter = this.getFilter() as Record<string, unknown>;
      if (filter.tenantId === undefined || filter.tenantId === null) {
        throw new TenantGuardError(this.model.modelName, op);
      }
    });
  }
  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    const opts = this.options as { skipTenantGuard?: boolean };
    if (opts?.skipTenantGuard) return;
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!first?.$match || first.$match.tenantId === undefined) {
      throw new TenantGuardError('aggregate', 'aggregate');
    }
  });
}
