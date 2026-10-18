import { describe, expect, it } from 'vitest';
import { MESSAGES } from './messages';

describe('UI messages', () => {
  it('defines every key in Arabic and English', () => {
    const ar = Object.keys(MESSAGES.ar).sort();
    const en = Object.keys(MESSAGES.en).sort();
    expect(en).toEqual(ar);
    for (const k of ar) expect((MESSAGES.en as Record<string, string>)[k]).toBeTruthy();
  });
});
