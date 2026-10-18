import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { z } from 'zod';

/**
 * Password hashing with Node's built-in scrypt (no native addon, so it works
 * unchanged on serverless platforms). Parameters follow the OWASP Password
 * Storage Cheat Sheet scrypt profile N=2^15, r=8, p=3 (~32 MiB per hash).
 * Format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>; parameters are stored per
 * hash so they can be raised later without invalidating existing passwords.
 */
const N = 2 ** 15;
const R = 8;
const P = 3;
const KEY_LEN = 64;

export const PasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password.normalize('NFKC'), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

const maxmem = (n: number, r: number, p: number) => 128 * n * r * p + 128 * r * 2 + 1024 * 1024;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEY_LEN, { N, r: R, p: P, maxmem: maxmem(N, R, P) });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 2 ** 20) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  try {
    const key = await scrypt(plain, salt, expected.length, { N: n, r, p, maxmem: maxmem(n, r, p) });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash uses weaker parameters than the current policy (rehash on next login). */
export function needsRehash(hash: string): boolean {
  const [alg, n, r, p] = hash.split('$');
  return alg !== 'scrypt' || Number(n) < N || Number(r) < R || Number(p) < P;
}

// Used when the account does not exist, so response timing does not reveal valid emails.
let dummyHash: Promise<string> | undefined;
export const getDummyHash = (): Promise<string> => (dummyHash ??= hashPassword('dummy-password-for-timing'));
