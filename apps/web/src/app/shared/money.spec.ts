import { describe, expect, it } from 'vitest';
import { formatMoney, fromPiastres, toPiastres } from './money';

describe('money helpers', () => {
  it('converts decimal strings to integer piastres without floating point', () => {
    expect(toPiastres('0.1') + toPiastres('0.2')).toBe(30n);
    expect(toPiastres('12.345')).toBe(1235n);
    expect(toPiastres('-1.50')).toBe(-150n);
    expect(fromPiastres(toPiastres('200') - toPiastres('114.00'))).toBe('86.00');
  });
  it('formats EGP for Arabic and English locales', () => {
    expect(formatMoney('1234.5', 'en-EG')).toContain('1,234.50');
    expect(formatMoney('10', 'ar-EG')).toMatch(/١٠٫٠٠|10\.00/);
    expect(formatMoney('abc', 'en-EG')).toBe('—');
  });
});
