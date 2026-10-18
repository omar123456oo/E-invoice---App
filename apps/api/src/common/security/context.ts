import { Types } from 'mongoose';
import { AppError } from '../errors/app-error.js';
import type { Permission, Role } from './permissions.js';

/**
 * Authenticated request context. Services receive this object instead of the
 * raw request, and every tenant-scoped query is built from ctx.tenantId.
 */
export interface RequestContext {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId | null;
  role: Role;
  permissions: ReadonlySet<Permission>;
  /** 'ALL' for roles with tenant-wide branch access. */
  branchIds: Types.ObjectId[] | 'ALL';
  sessionId: string;
  requestId: string;
  ip: string | undefined;
  userAgent: string | undefined;
}

export function requireTenant(ctx: RequestContext): Types.ObjectId {
  if (!ctx.tenantId) throw AppError.forbidden('This operation requires a company account');
  return ctx.tenantId;
}

export function hasPermission(ctx: RequestContext, p: Permission): boolean {
  return ctx.permissions.has(p);
}

export function assertPermission(ctx: RequestContext, p: Permission): void {
  if (!hasPermission(ctx, p)) throw AppError.forbidden();
}

export function canAccessBranch(ctx: RequestContext, branchId: Types.ObjectId | string): boolean {
  if (ctx.branchIds === 'ALL') return true;
  const id = String(branchId);
  return ctx.branchIds.some((b) => String(b) === id);
}

export function assertBranchAccess(ctx: RequestContext, branchId: Types.ObjectId | string): void {
  if (!canAccessBranch(ctx, branchId)) throw AppError.forbidden('You are not assigned to this branch', 'BRANCH_FORBIDDEN');
}

/** Mongo filter fragment restricting a query to the branches the user may see. */
export function branchFilter(ctx: RequestContext, requested?: string): Record<string, unknown> {
  if (requested) {
    assertBranchAccess(ctx, requested);
    return { branchId: new Types.ObjectId(requested) };
  }
  return ctx.branchIds === 'ALL' ? {} : { branchId: { $in: ctx.branchIds } };
}
