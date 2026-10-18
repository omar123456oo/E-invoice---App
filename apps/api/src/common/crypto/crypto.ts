import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** SHA-256 hex digest of raw bytes (file contents). */
export function sha256Bytes(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Cryptographically random URL-safe token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * AES-256-GCM envelope for secrets stored in MongoDB (ETA POS credentials,
 * MFA secrets). Format: v1.<iv>.<tag>.<ciphertext>, all base64url.
 * In production the key should come from a secret manager / KMS.
 */
export function encryptSecret(plaintext: string, key = keyFromEnv()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(envelope: string, key = keyFromEnv()): string {
  const [version, iv, tag, ct] = envelope.split('.');
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported secret envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

function keyFromEnv(): Buffer {
  return Buffer.from(env().DATA_ENCRYPTION_KEY, 'base64');
}
