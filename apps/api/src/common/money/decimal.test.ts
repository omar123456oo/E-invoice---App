import { describe, expect, it } from 'vitest';
import { dec, fixed, round, sum, toDecimal128 } from './decimal.js';

describe('decimal helpers', () => {
  it('avoids binary floating point errors', () => {
    expect(dec('0.1').plus('0.2').toFixed()).toBe('0.3');
  });

  it('rounds half up by default', () => {
    expect(fixed('1.005', 2)).toBe('1.01');
    expect(fixed('2.345', 2)).toBe('2.35');
    expect(fixed('-2.345', 2)).toBe('-2.35');
  });

  it('supports half-even rounding', () => {
    expect(round('2.345', 2, 'HALF_EVEN').toFixed(2)).toBe('2.34');
    expect(round('2.355', 2, 'HALF_EVEN').toFixed(2)).toBe('2.36');
  });

  it('rejects fractional JS numbers and malformed strings', () => {
    expect(() => dec(0.1)).toThrow();
    expect(() => dec('1e5')).toThrow();
    expect(() => dec('abc')).toThrow();
    expect(dec(5).toFixed()).toBe('5');
  });

  it('sums lists exactly', () => {
    expect(sum(['10.10', '20.20', '0.01']).toFixed(2)).toBe('30.31');
  });

  it('keeps the scale of decimal strings when converting to Decimal128 (regression)', () => {
    expect(toDecimal128('50.00').toString()).toBe('50.00');
    expect(() => toDecimal128('5e3')).toThrow();
  });
});
