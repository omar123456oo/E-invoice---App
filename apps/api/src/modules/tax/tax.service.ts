import type { ClientSession, Types } from 'mongoose';
import { AppError } from '../../common/errors/app-error.js';
import { withTransaction } from '../../common/db/mongo.js';
import type { RequestContext } from '../../common/security/context.js';
import { requireTenant } from '../../common/security/context.js';
import { fromContext, recordAudit } from '../audit/audit.service.js';
import { assertSupported, type TaxRuleSnapshot } from './calculation.js';
import { TaxConfigurationModel } from './tax-configuration.model.js';

export interface NewTaxVersion {
  code: string;
  name: string;
  etaTaxType: string;
  etaSubType: string;
  treatment: 'PERCENTAGE' | 'EXEMPT';
  rate: string;
  effectiveFrom: Date;
  verification: { source: string; verifiedBy: string; verifiedAt: Date; notes?: string | null };
}

/**
 * Creates a new version of a tax rule. The previous open version is closed at
 * the new effectiveFrom. Back-dating before the latest version is refused so
 * that already-issued receipts keep a consistent rule history.
 */
export async function createTaxVersion(ctx: RequestContext, input: NewTaxVersion) {
  const tenantId = requireTenant(ctx);
  assertSupported(input);
  return withTransaction(async (session) => {
    const latest = await TaxConfigurationModel.findOne({ tenantId, code: input.code }).sort({ version: -1 }).session(session);
    if (latest && input.effectiveFrom <= latest.effectiveFrom) {
      throw AppError.businessRule('effectiveFrom must be after the latest version', 'TAX_VERSION_BACKDATED');
    }
    if (latest && !latest.effectiveTo) {
      latest.effectiveTo = input.effectiveFrom;
      await latest.save({ session });
    }
    const [created] = await TaxConfigurationModel.create(
      [{ ...input, tenantId, version: (latest?.version ?? 0) + 1, createdBy: ctx.userId }],
      { session },
    );
    await recordAudit({ ...fromContext(ctx), action: 'tax.version_created', entityType: 'TaxConfiguration', entityId: created!._id, changes: { ...input, version: created!.version } }, session);
    return created!.toJSON();
  });
}

export async function retireTaxRule(ctx: RequestContext, code: string, effectiveTo: Date) {
  const tenantId = requireTenant(ctx);
  const open = await TaxConfigurationModel.findOne({ tenantId, code, effectiveTo: null });
  if (!open) throw AppError.notFound('Open tax rule');
  if (effectiveTo <= open.effectiveFrom) throw AppError.businessRule('effectiveTo must be after effectiveFrom', 'INVALID_DATES');
  open.effectiveTo = effectiveTo;
  await open.save();
  await recordAudit({ ...fromContext(ctx), action: 'tax.rule_retired', entityType: 'TaxConfiguration', entityId: open._id, changes: { code, effectiveTo } });
  return open.toJSON();
}

/** Resolves the rule versions in force at `at` for the given codes. Fails if any code has no rule in force. */
export async function resolveTaxRules(tenantId: Types.ObjectId, codes: string[], at: Date, session?: ClientSession): Promise<Map<string, TaxRuleSnapshot>> {
  const unique = [...new Set(codes)];
  const rules = await TaxConfigurationModel.find({
    tenantId,
    code: { $in: unique },
    effectiveFrom: { $lte: at },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }],
  }).session(session ?? null).lean();
  const map = new Map<string, TaxRuleSnapshot>();
  for (const r of rules) {
    map.set(r.code, { code: r.code, version: r.version, etaTaxType: r.etaTaxType, etaSubType: r.etaSubType, treatment: r.treatment as 'PERCENTAGE' | 'EXEMPT', rate: r.rate.toString() });
  }
  const missing = unique.filter((c) => !map.has(c));
  if (missing.length) {
    throw AppError.businessRule(`No tax rule in force for: ${missing.join(', ')}`, 'TAX_RULE_NOT_IN_FORCE', missing.map((m) => ({ message: m })));
  }
  return map;
}
