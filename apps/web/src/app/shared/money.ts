/**
 * Display helpers for decimal-string money. The browser never computes
 * business totals; these helpers only format server values and compute
 * display-only cash change in integer piastres (no floating point).
 */
const DECIMAL = /^-?\d+(\.\d+)?$/;

export function isDecimal(v: string | null | undefined): v is string {
  return typeof v === 'string' && DECIMAL.test(v.trim());
}

/** "12.5" -> 1250n piastres. Rounds half up beyond 2 decimals. */
export function toPiastres(v: string): bigint {
  const s = v.trim();
  if (!DECIMAL.test(s)) throw new Error(`Invalid amount: ${v}`);
  const neg = s.startsWith('-');
  const [int, frac = ''] = s.replace('-', '').split('.');
  const padded = (frac + '000').slice(0, 3);
  let p = BigInt(int!) * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) p += 1n;
  return neg ? -p : p;
}

export function fromPiastres(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  const s = `${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

export function formatMoney(value: string | null | undefined, locale: string, currency = 'EGP'): string {
  if (!isDecimal(value)) return '—';
  // Format from integer piastres split into parts so no precision is lost for large values.
  const p = toPiastres(value);
  const nf = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p <= BigInt(Number.MAX_SAFE_INTEGER) && p >= -BigInt(Number.MAX_SAFE_INTEGER)) return nf.format(Number(p) / 100);
  return `${fromPiastres(p)} ${currency}`;
}
