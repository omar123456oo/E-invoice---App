import { Decimal as DecimalJs } from 'decimal.js';
import { Types } from 'mongoose';

/**
 * Isolated Decimal constructor for all financial arithmetic. JavaScript
 * floating point numbers are never used for money in this codebase.
 */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });
export type Decimal = InstanceType<typeof Decimal>;

export type DecimalInput = Decimal | string | number | Types.Decimal128;

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN';

const MODES: Record<RoundingMode, DecimalJs.Rounding> = {
  HALF_UP: DecimalJs.ROUND_HALF_UP,
  HALF_EVEN: DecimalJs.ROUND_HALF_EVEN,
  DOWN: DecimalJs.ROUND_DOWN,
};

/** Strict decimal string: optional minus, digits, optional fraction. No exponent. */
export const DECIMAL_STRING_RE = /^-?\d{1,15}(\.\d{1,10})?$/;

export function dec(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  if (value instanceof Types.Decimal128) return new Decimal(value.toString());
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number in monetary arithmetic');
    // Only integers may enter as numbers; fractional values must be strings.
    if (!Number.isInteger(value)) throw new Error('Fractional numbers must be passed as decimal strings');
    return new Decimal(value);
  }
  if (!DECIMAL_STRING_RE.test(value)) throw new Error(`Invalid decimal string: ${value}`);
  return new Decimal(value);
}

export function round(value: DecimalInput, scale: number, mode: RoundingMode = 'HALF_UP'): Decimal {
  return dec(value).toDecimalPlaces(scale, MODES[mode]);
}

/** Fixed-scale string, e.g. fixed('1.005', 2) === '1.01'. */
export function fixed(value: DecimalInput, scale: number, mode: RoundingMode = 'HALF_UP'): string {
  return dec(value).toFixed(scale, MODES[mode]);
}

export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), new Decimal(0));
}

/** Preserves the scale of decimal strings ("50.00" stays "50.00"), which keeps stored amounts identical to issued ones. */
export function toDecimal128(value: DecimalInput): Types.Decimal128 {
  if (typeof value === 'string') {
    dec(value);
    return Types.Decimal128.fromString(value);
  }
  return Types.Decimal128.fromString(dec(value).toFixed());
}

export function d128ToString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Types.Decimal128) return value.toString();
  return String(value);
}
