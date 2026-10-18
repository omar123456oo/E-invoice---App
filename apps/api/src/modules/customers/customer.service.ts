import { createHmac } from 'node:crypto';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { decryptSecret, encryptSecret } from '../../common/crypto/crypto.js';
import { AppError } from '../../common/errors/app-error.js';
import { CustomerModel } from './customer.model.js';

export function normaliseIdentity(id: string): string {
  return id.replace(/[\s-]/g, '').toUpperCase();
}

/** Keyed hash so identity numbers cannot be brute-forced from a database dump alone. */
export function identityHash(tenantId: Types.ObjectId, id: string): string {
  return createHmac('sha256', Buffer.from(env().DATA_ENCRYPTION_KEY, 'base64')).update(`${tenantId}:${normaliseIdentity(id)}`).digest('hex');
}

export function validateIdentity(buyerType: 'P' | 'B' | 'F', id: string): void {
  const n = normaliseIdentity(id);
  // Egyptian national ID: 14 digits. Business RIN: digits (receipt v1.2 limits id to 30 chars).
  if (buyerType === 'P' && !/^\d{14}$/.test(n)) throw AppError.validation([{ path: 'identity', message: 'National ID must be 14 digits' }]);
  if (buyerType === 'B' && !/^\d{1,30}$/.test(n)) throw AppError.validation([{ path: 'identity', message: 'Registration number must be numeric' }]);
  if (n.length > 30) throw AppError.validation([{ path: 'identity', message: 'Identity number is too long' }]);
}

export function protectIdentity(tenantId: Types.ObjectId, id: string) {
  const n = normaliseIdentity(id);
  return { identityEnc: encryptSecret(n), identityHash: identityHash(tenantId, n), identityLast4: n.slice(-4) };
}

/** Decrypted identity, for building the ETA buyer block only. */
export async function revealIdentity(tenantId: Types.ObjectId, customerId: Types.ObjectId): Promise<string | null> {
  const c = await CustomerModel.findOne({ _id: customerId, tenantId }).select('+identityEnc').lean();
  return c?.identityEnc ? decryptSecret(c.identityEnc) : null;
}
