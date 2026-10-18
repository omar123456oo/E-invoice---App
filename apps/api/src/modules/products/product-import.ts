import type { Types } from 'mongoose';
import type { z } from 'zod';
import type { ErrorDetail } from '../../common/errors/app-error.js';
import { TaxConfigurationModel } from '../tax/tax-configuration.model.js';
import { ProductModel } from './product.model.js';
import { ProductBody } from './product.schema.js';

export type ProductInput = z.infer<typeof ProductBody>;
export interface RowError { row: number; errors: ErrorDetail[] }

/** Columns of the product import template, in order. `taxCodes` is a list separated by ";" or ",". */
export const PRODUCT_COLUMNS = ['kind', 'internalCode', 'barcode', 'nameAr', 'nameEn', 'description', 'etaItemType', 'etaItemCode', 'unitType', 'unitPrice', 'taxCodes'] as const;

/** Converts a spreadsheet row (all cells as text) into the API shape. */
export function normaliseProductRow(raw: Record<string, unknown>): Record<string, unknown> {
  const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
  const out: Record<string, unknown> = {};
  for (const c of PRODUCT_COLUMNS) {
    const v = text(raw[c]);
    if (c === 'taxCodes') out[c] = v ? v.split(/[;,]/).map((x) => x.trim().toUpperCase()).filter(Boolean) : [];
    else if (c === 'kind' || c === 'etaItemType') out[c] = v.toUpperCase();
    else if (v !== '' || !['barcode', 'nameEn'].includes(c)) out[c] = v;
  }
  return out;
}

/** Row-level validation shared by the JSON bulk endpoint and the file import centre. */
export async function validateProductRows(tenantId: Types.ObjectId, rows: Array<Record<string, unknown>>): Promise<{ valid: Array<{ row: number; data: ProductInput }>; errors: RowError[] }> {
  const errors: RowError[] = [];
  const parsed: Array<{ row: number; data: ProductInput }> = [];
  const seen = new Set<string>();
  for (const [i, raw] of rows.entries()) {
    const r = ProductBody.safeParse(raw);
    if (!r.success) {
      errors.push({ row: i + 1, errors: r.error.issues.map((x) => ({ path: x.path.join('.'), message: x.message })) });
      continue;
    }
    if (seen.has(r.data.internalCode)) {
      errors.push({ row: i + 1, errors: [{ path: 'internalCode', message: 'Duplicate internalCode in file' }] });
      continue;
    }
    seen.add(r.data.internalCode);
    parsed.push({ row: i + 1, data: r.data });
  }
  const codes = [...new Set(parsed.flatMap((v) => v.data.taxCodes))];
  const known = new Set<string>(await TaxConfigurationModel.distinct('code', { tenantId, code: { $in: codes } }));
  const existing = new Set<string>(await ProductModel.distinct('internalCode', { tenantId, internalCode: { $in: parsed.map((v) => v.data.internalCode) } }));
  const valid = parsed.filter((v) => {
    const e: ErrorDetail[] = [];
    const bad = v.data.taxCodes.filter((c) => !known.has(c));
    if (bad.length) e.push({ path: 'taxCodes', message: `Unknown tax codes: ${bad.join(', ')}` });
    if (existing.has(v.data.internalCode)) e.push({ path: 'internalCode', message: 'A product with this internalCode already exists' });
    if (e.length) errors.push({ row: v.row, errors: e });
    return e.length === 0;
  });
  return { valid, errors: errors.sort((a, b) => a.row - b.row) };
}
