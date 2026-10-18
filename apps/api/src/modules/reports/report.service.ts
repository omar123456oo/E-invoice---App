import type { PipelineStage } from 'mongoose';
import { dec, Decimal } from '../../common/money/decimal.js';
import { branchFilter, requireTenant, type RequestContext } from '../../common/security/context.js';
import { EtaSubmissionModel } from '../eta/eta-submission.model.js';
import { PaymentModel } from '../payments/payment.model.js';
import { ReceiptModel } from '../receipts/receipt.model.js';

export interface ReportFilter {
  from: Date;
  to: Date;
  branchId?: string;
  timezone?: string;
}

const str = (v: unknown): string => (v === null || v === undefined ? '0' : String(v));
const money = (v: unknown): string => dec(str(v)).toFixed(2);

function baseMatch(ctx: RequestContext, f: ReportFilter): Record<string, unknown> {
  return { tenantId: requireTenant(ctx), ...branchFilter(ctx, f.branchId), dateTimeIssued: { $gte: f.from, $lt: f.to } };
}

/**
 * Operational dashboard. Every figure is aggregated from persisted receipts
 * and payments. Sales and returns are read from issued receipts regardless of
 * ETA status; the ETA breakdown is reported separately, so the dashboard never
 * implies that internal sales equal officially registered sales.
 */
export async function dashboard(ctx: RequestContext, f: ReportFilter) {
  const match = baseMatch(ctx, f);
  const tenantId = requireTenant(ctx);
  const tz = f.timezone ?? 'Africa/Cairo';

  const [byKind, taxes, byBranch, byDevice, etaStatus, daily, payments, recent, problems, queueHealth, lastSubmission] = await Promise.all([
    ReceiptModel.aggregate([{ $match: match }, { $group: { _id: '$kind', count: { $sum: 1 }, totalSales: { $sum: '$totals.totalSales' }, discounts: { $sum: '$totals.totalCommercialDiscount' }, netAmount: { $sum: '$totals.netAmount' }, totalAmount: { $sum: '$totals.totalAmount' } } }]),
    ReceiptModel.aggregate([{ $match: match }, { $unwind: '$totals.taxTotals' }, { $group: { _id: { kind: '$kind', taxType: '$totals.taxTotals.taxType' }, amount: { $sum: '$totals.taxTotals.amount' } } }]),
    ReceiptModel.aggregate([{ $match: match }, { $group: { _id: { branchId: '$branchId', kind: '$kind' }, count: { $sum: 1 }, totalAmount: { $sum: '$totals.totalAmount' } } }, { $lookup: { from: 'branches', localField: '_id.branchId', foreignField: '_id', as: 'b' } }]),
    ReceiptModel.aggregate([{ $match: match }, { $group: { _id: { deviceId: '$deviceId', kind: '$kind' }, count: { $sum: 1 }, totalAmount: { $sum: '$totals.totalAmount' } } }, { $lookup: { from: 'posDevices', localField: '_id.deviceId', foreignField: '_id', as: 'd' } }]),
    ReceiptModel.aggregate([{ $match: match }, { $group: { _id: '$eta.status', count: { $sum: 1 } } }]),
    ReceiptModel.aggregate([{ $match: match }, { $group: { _id: { day: { $dateToString: { date: '$dateTimeIssued', format: '%Y-%m-%d', timezone: tz } }, kind: '$kind' }, totalAmount: { $sum: '$totals.totalAmount' }, count: { $sum: 1 } } }, { $sort: { '_id.day': 1 } }]),
    PaymentModel.aggregate([{ $match: { tenantId, ...branchFilter(ctx, f.branchId), recordedAt: { $gte: f.from, $lt: f.to } } }, { $group: { _id: { direction: '$direction', method: '$method', status: '$status' }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    ReceiptModel.find(match).select('receiptNumber kind dateTimeIssued totals.totalAmount eta.status branchId').sort({ dateTimeIssued: -1 }).limit(10).lean(),
    ReceiptModel.find({ tenantId, ...branchFilter(ctx, f.branchId), 'eta.status': { $in: ['REJECTED', 'FAILED', 'INVALID', 'UNKNOWN'] } })
      .select('receiptNumber kind dateTimeIssued eta.status eta.lastError eta.statusChangedAt').sort({ 'eta.statusChangedAt': -1 }).limit(10).lean(),
    ReceiptModel.aggregate([{ $match: { tenantId, 'eta.status': { $in: ['QUEUED', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN'] } } }, { $group: { _id: '$eta.status', count: { $sum: 1 }, oldest: { $min: '$eta.statusChangedAt' } } }]),
    EtaSubmissionModel.findOne({ tenantId }).sort({ sentAt: -1 }).select('status sentAt httpStatus errorCode environment').lean(),
  ]);

  const kind = (k: string) => byKind.find((x) => x._id === k);
  const sale = kind('SALE');
  const ret = kind('RETURN');
  const taxMap = new Map<string, Decimal>();
  for (const t of taxes) {
    const cur = taxMap.get(t._id.taxType) ?? new Decimal(0);
    taxMap.set(t._id.taxType, t._id.kind === 'RETURN' ? cur.minus(str(t.amount)) : cur.plus(str(t.amount)));
  }
  const collapse = (rows: Array<{ _id: Record<string, unknown>; count: number; totalAmount: unknown }>, key: string, nameOf: (r: never) => string) => {
    const m = new Map<string, { id: string; name: string; salesCount: number; sales: Decimal; returns: Decimal }>();
    for (const r of rows) {
      const id = String(r._id[key]);
      const e = m.get(id) ?? { id, name: nameOf(r as never), salesCount: 0, sales: new Decimal(0), returns: new Decimal(0) };
      if (r._id.kind === 'SALE') {
        e.sales = e.sales.plus(str(r.totalAmount));
        e.salesCount += r.count;
      } else e.returns = e.returns.plus(str(r.totalAmount));
      m.set(id, e);
    }
    return [...m.values()].map((e) => ({ id: e.id, name: e.name, salesCount: e.salesCount, sales: e.sales.toFixed(2), returns: e.returns.toFixed(2), net: e.sales.minus(e.returns).toFixed(2) }));
  };
  const days = new Map<string, { day: string; sales: Decimal; returns: Decimal; count: number }>();
  for (const d of daily) {
    const e = days.get(d._id.day) ?? { day: d._id.day, sales: new Decimal(0), returns: new Decimal(0), count: 0 };
    if (d._id.kind === 'SALE') {
      e.sales = e.sales.plus(str(d.totalAmount));
      e.count += d.count;
    } else e.returns = e.returns.plus(str(d.totalAmount));
    days.set(d._id.day, e);
  }

  return {
    period: { from: f.from, to: f.to, timezone: tz },
    sales: {
      receiptCount: sale?.count ?? 0,
      grossSales: money(sale?.totalSales),
      discounts: money(sale?.discounts),
      netSalesExcludingTax: money(sale?.netAmount),
      totalIncludingTax: money(sale?.totalAmount),
    },
    returns: { receiptCount: ret?.count ?? 0, totalIncludingTax: money(ret?.totalAmount), netAmountExcludingTax: money(ret?.netAmount) },
    netRevenueIncludingTax: dec(str(sale?.totalAmount)).minus(str(ret?.totalAmount)).toFixed(2),
    taxByType: [...taxMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([taxType, amount]) => ({ taxType, netAmount: amount.toFixed(2) })),
    byBranch: collapse(byBranch, 'branchId', (r: { b: Array<{ name: string }> }) => r.b[0]?.name ?? 'Unknown'),
    byDevice: collapse(byDevice, 'deviceId', (r: { d: Array<{ name: string }> }) => r.d[0]?.name ?? 'Unknown'),
    daily: [...days.values()].map((d) => ({ day: d.day, receiptCount: d.count, sales: d.sales.toFixed(2), returns: d.returns.toFixed(2) })),
    payments: payments.map((p) => ({ direction: p._id.direction, method: p._id.method, status: p._id.status, count: p.count, amount: money(p.amount) })),
    eta: {
      byStatus: Object.fromEntries(etaStatus.map((s) => [s._id, s.count])),
      openWork: queueHealth.map((q) => ({ status: q._id, count: q.count, oldestSince: q.oldest })),
      lastSubmission,
    },
    recentReceipts: recent.map((r) => ({ id: String(r._id), receiptNumber: r.receiptNumber, kind: r.kind, dateTimeIssued: r.dateTimeIssued, totalAmount: money(r.totals.totalAmount), etaStatus: r.eta.status })),
    integrationProblems: problems.map((r) => ({ id: String(r._id), receiptNumber: r.receiptNumber, kind: r.kind, etaStatus: r.eta.status, since: r.eta.statusChangedAt, error: r.eta.lastError?.message ?? r.eta.lastError?.code ?? null })),
  };
}

export async function salesByProduct(ctx: RequestContext, f: ReportFilter) {
  const pipeline: PipelineStage[] = [
    { $match: baseMatch(ctx, f) },
    { $unwind: '$lines' },
    { $group: { _id: { productId: '$lines.productId', kind: '$kind' }, internalCode: { $first: '$lines.internalCode' }, description: { $first: '$lines.description' }, quantity: { $sum: '$lines.quantity' }, netSale: { $sum: '$lines.netSale' }, total: { $sum: '$lines.total' } } },
    { $sort: { total: -1 } },
    { $limit: 2000 },
  ];
  const rows = await ReceiptModel.aggregate(pipeline);
  const m = new Map<string, { productId: string; internalCode: string; description: string; qtySold: Decimal; qtyReturned: Decimal; net: Decimal; total: Decimal }>();
  for (const r of rows) {
    const id = String(r._id.productId);
    const e = m.get(id) ?? { productId: id, internalCode: r.internalCode, description: r.description, qtySold: new Decimal(0), qtyReturned: new Decimal(0), net: new Decimal(0), total: new Decimal(0) };
    const sign = r._id.kind === 'RETURN' ? -1 : 1;
    if (sign > 0) e.qtySold = e.qtySold.plus(str(r.quantity));
    else e.qtyReturned = e.qtyReturned.plus(str(r.quantity));
    e.net = e.net.plus(dec(str(r.netSale)).times(sign));
    e.total = e.total.plus(dec(str(r.total)).times(sign));
    m.set(id, e);
  }
  return [...m.values()]
    .sort((a, b) => b.total.cmp(a.total))
    .map((e) => ({ productId: e.productId, internalCode: e.internalCode, description: e.description, quantitySold: e.qtySold.toFixed(), quantityReturned: e.qtyReturned.toFixed(), netExcludingTax: e.net.toFixed(2), totalIncludingTax: e.total.toFixed(2) }));
}

export async function salesByCashier(ctx: RequestContext, f: ReportFilter) {
  const rows = await ReceiptModel.aggregate([
    { $match: baseMatch(ctx, f) },
    { $group: { _id: { cashierId: '$cashierId', kind: '$kind' }, count: { $sum: 1 }, total: { $sum: '$totals.totalAmount' } } },
    { $lookup: { from: 'users', localField: '_id.cashierId', foreignField: '_id', as: 'u' } },
  ]);
  const m = new Map<string, { cashierId: string; name: string; receipts: number; sales: Decimal; returns: Decimal }>();
  for (const r of rows) {
    const id = String(r._id.cashierId);
    const e = m.get(id) ?? { cashierId: id, name: r.u[0]?.name ?? 'Unknown', receipts: 0, sales: new Decimal(0), returns: new Decimal(0) };
    if (r._id.kind === 'SALE') {
      e.receipts += r.count;
      e.sales = e.sales.plus(str(r.total));
    } else e.returns = e.returns.plus(str(r.total));
    m.set(id, e);
  }
  return [...m.values()].map((e) => ({ cashierId: e.cashierId, name: e.name, saleReceipts: e.receipts, sales: e.sales.toFixed(2), returns: e.returns.toFixed(2), net: e.sales.minus(e.returns).toFixed(2) }));
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
    // Prevent CSV/formula injection when opened in spreadsheet software.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n');
}

