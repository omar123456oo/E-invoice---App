import argon2 from 'argon2';
import { z } from 'zod';

/** OWASP-recommended argon2id parameters (19 MiB, t=2, p=1). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PasswordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters');

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Used when the account does not exist, so response timing does not reveal valid emails.
let dummyHash: Promise<string> | undefined;
export const getDummyHash = (): Promise<string> => (dummyHash ??= hashPassword('dummy-password-for-timing'));
