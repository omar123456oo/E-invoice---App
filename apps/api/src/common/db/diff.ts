/** Shallow field diff for audit records: { field: { from, to } }. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const a = norm(before[f]);
    const b = norm(after[f]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[f] = { from: a, to: b };
  }
  return out;
}

function norm(v: unknown): unknown {
  if (v === undefined) return null;
  if (v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function' &&
    ((v as { _bsontype?: string })._bsontype === 'Decimal128' || (v as { _bsontype?: string })._bsontype === 'ObjectId')) return String(v);
  return v;
}
