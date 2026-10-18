import type { ClientSession, Types } from 'mongoose';
import { sha256Hex } from '../../common/crypto/crypto.js';
import { logger } from '../../common/logging/logger.js';
import type { RequestContext } from '../../common/security/context.js';
import { AuditEventModel } from './audit-event.model.js';

export const GENESIS_HASH = '0'.repeat(64);

const SENSITIVE_KEYS = /pass(word)?|secret|token|presharedkey|national.?id|cvv|card.?number|pan$/i;

/** Removes secrets and direct identifiers from audit change payloads. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (typeof (value as { toHexString?: unknown }).toHexString === 'function') return String(value);
    if ((value as { _bsontype?: string })._bsontype === 'Decimal128') return String(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    return out;
  }
  return value;
}

export interface AuditInput {
  action: string;
  outcome?: 'success' | 'failure';
  tenantId?: Types.ObjectId | null;
  branchId?: Types.ObjectId | null;
  entityType?: string;
  entityId?: string | Types.ObjectId;
  summary?: string;
  changes?: unknown;
  actor?: { userId: Types.ObjectId | null; role: string | null; type: 'user' | 'system' | 'anonymous' };
  requestId?: string;
  ip?: string;
}

function canonical(e: Record<string, unknown>): string {
  return JSON.stringify(e, Object.keys(e).sort());
}

function hashPayload(e: {
  chainKey: string; seq: number; at: Date; action: string; outcome: string; entityType: string | null; entityId: string | null;
  actorUserId: string | null; summary: string | null; changes: unknown; prevHash: string;
}): string {
  return sha256Hex(canonical({ ...e, at: e.at.toISOString(), changes: JSON.stringify(e.changes ?? null) }));
}

export function fromContext(ctx: RequestContext): Pick<AuditInput, 'tenantId' | 'actor' | 'requestId' | 'ip'> {
  return {
    tenantId: ctx.tenantId,
    actor: { userId: ctx.userId, role: ctx.role, type: 'user' },
    requestId: ctx.requestId,
    ip: ctx.ip,
  };
}

/**
 * Appends an audit event to the tenant chain. Concurrent writers race on the
 * unique (chainKey, seq) index; the loser retries with the new chain head.
 */
export async function recordAudit(input: AuditInput, session?: ClientSession): Promise<void> {
  const chainKey = input.tenantId ? String(input.tenantId) : 'platform';
  const changes = input.changes === undefined ? null : redact(input.changes);
  for (let attempt = 0; attempt < 8; attempt++) {
    const last = await AuditEventModel.findOne({ chainKey }, { seq: 1, hash: 1 }).sort({ seq: -1 }).session(session ?? null).lean();
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const at = new Date();
    const entityId = input.entityId ? String(input.entityId) : null;
    const hash = hashPayload({
      chainKey, seq, at, action: input.action, outcome: input.outcome ?? 'success', entityType: input.entityType ?? null,
      entityId, actorUserId: input.actor?.userId ? String(input.actor.userId) : null, summary: input.summary ?? null, changes, prevHash,
    });
    try {
      await AuditEventModel.create(
        [{
          chainKey, seq, at, prevHash, hash, changes, entityId,
          tenantId: input.tenantId ?? null,
          branchId: input.branchId ?? null,
          actor: input.actor ?? { userId: null, role: null, type: 'system' },
          action: input.action,
          outcome: input.outcome ?? 'success',
          entityType: input.entityType ?? null,
          summary: input.summary ?? null,
          requestId: input.requestId ?? null,
          ip: input.ip ?? null,
        }],
        { session },
      );
      return;
    } catch (err) {
      if ((err as { code?: number }).code === 11000 && !session) continue;
      throw err;
    }
  }
  logger.error({ action: input.action }, 'Audit chain contention: event could not be recorded');
  throw new Error('Could not record audit event');
}

export interface ChainVerification {
  valid: boolean;
  checked: number;
  brokenAtSeq?: number;
}

/** Re-computes the chain for a tenant and reports the first inconsistency. */
export async function verifyChain(tenantId: Types.ObjectId | null): Promise<ChainVerification> {
  const chainKey = tenantId ? String(tenantId) : 'platform';
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  let checked = 0;
  const cursor = AuditEventModel.find({ chainKey }).sort({ seq: 1 }).lean().cursor();
  for await (const e of cursor) {
    const recomputed = hashPayload({
      chainKey, seq: e.seq, at: e.at, action: e.action, outcome: e.outcome ?? 'success', entityType: e.entityType ?? null,
      entityId: e.entityId ?? null, actorUserId: e.actor?.userId ? String(e.actor.userId) : null, summary: e.summary ?? null,
      changes: e.changes, prevHash,
    });
    if (e.seq !== expectedSeq || e.prevHash !== prevHash || e.hash !== recomputed) return { valid: false, checked, brokenAtSeq: e.seq };
    prevHash = e.hash;
    expectedSeq++;
    checked++;
  }
  return { valid: true, checked };
}
