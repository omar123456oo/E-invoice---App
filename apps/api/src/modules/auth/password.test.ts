import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from './password.js';

describe('password hashing (scrypt)', () => {
  it('verifies the right password only and salts every hash', async () => {
    const a = await hashPassword('correct-horse-battery');
    const b = await hashPassword('correct-horse-battery');
    expect(a).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'correct-horse-battery')).toBe(true);
    expect(await verifyPassword(a, 'wrong-horse-battery')).toBe(false);
  });
  it('rejects malformed or unknown hash formats', async () => {
    expect(await verifyPassword('$argon2id$v=19$whatever', 'x')).toBe(false);
    expect(await verifyPassword('scrypt$9999999999$8$3$a$b', 'x')).toBe(false);
    expect(needsRehash('scrypt$16384$8$1$a$b')).toBe(true);
    expect(needsRehash(await hashPassword('x'.repeat(10)))).toBe(false);
  });
});
