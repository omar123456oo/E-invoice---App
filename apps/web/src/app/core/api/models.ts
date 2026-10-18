/** DTOs mirroring the API (see docs/openapi.json). Monetary values are decimal strings. */
export type Role = 'PLATFORM_ADMIN' | 'COMPANY_OWNER' | 'COMPANY_ADMIN' | 'FINANCE_MANAGER' | 'CASHIER' | 'ACCOUNTANT' | 'AUDITOR' | 'TECH_SUPPORT';
export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'WALLET' | 'VOUCHER' | 'GIFT_CARD' | 'POINTS' | 'OTHER';
export type EtaStatus = 'NOT_SUBMITTED' | 'QUEUED' | 'SUBMITTING' | 'UNKNOWN' | 'SUBMITTED' | 'REJECTED' | 'FAILED' | 'VALID' | 'INVALID' | 'CANCELLED' | 'SUPERSEDED';

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }

export interface ApiErrorBody { error: { code: string; message: string; requestId: string; details: Array<{ path?: string; message: string; code?: string }> } }

export interface User { id: string; tenantId: string | null; email: string; name: string; role: Role; branchIds: string[]; isActive: boolean; locale: 'ar' | 'en'; lastLoginAt: string | null; mfa?: { enabled: boolean } }
export interface Me { user: User; permissions: string[]; branchAccess: 'ALL' | string[] }

export interface Branch { id: string; name: string; etaBranchCode: string; isActive: boolean; address: Record<string, string | null> }
export interface PosDevice { id: string; branchId: string; name: string; code: string; serialNumber: string; osVersion: string; modelFramework: string; status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'DEACTIVATED'; credentialsConfigured: boolean; chain?: { seq: number } }

export interface Product {
  id: string; kind: 'GOODS' | 'SERVICE'; internalCode: string; barcode: string | null; nameAr: string; nameEn: string | null; description: string;
  etaItemType: 'GS1' | 'EGS'; etaItemCode: string; etaCodeStatus: 'UNVERIFIED' | 'APPROVED' | 'REJECTED'; unitType: string; unitPrice: string; taxCodes: string[]; isActive: boolean;
}

export interface TaxRule {
  id: string; code: string; version: number; name: string; etaTaxType: string; etaSubType: string; treatment: 'PERCENTAGE' | 'EXEMPT'; rate: string;
  effectiveFrom: string; effectiveTo: string | null; verification: { source: string; verifiedBy: string; verifiedAt: string; notes?: string | null };
}

export interface Discount { rate: string | null; amount: string; description: string }
export interface TaxLine { taxType: string; subType: string; rate: string; amount: string }
export interface CalcLine { lineNo: number; quantity: string; unitPrice: string; totalSale: string; commercialDiscount: Discount | null; netSale: string; taxableItems: TaxLine[]; itemDiscount: Discount | null; total: string }
export interface Totals { totalSales: string; totalCommercialDiscount: string; totalItemsDiscount: string; netAmount: string; extraReceiptDiscount: Discount | null; taxTotals: Array<{ taxType: string; amount: string }>; totalAmount: string }
export interface Quote { policyVersion: string; lines: CalcLine[]; totals: Totals }

export interface ReceiptLine extends CalcLine { productId: string; internalCode: string; description: string; itemType: string; itemCode: string; unitType: string; returnedQuantity: string; originalLineNo: number | null }
export interface Receipt {
  id: string; branchId: string; deviceId: string; transactionId: string; kind: 'SALE' | 'RETURN'; receiptNumber: string; chainSeq: number; uuid: string; previousUUID: string;
  referenceUUID: string | null; originalReceiptId: string | null; dateTimeIssued: string; currency: string; paymentMethodCode: string; printCount: number; returnStatus: 'NONE' | 'PARTIAL' | 'FULL';
  seller: { rin: string; companyTradeName: string; branchCode: string; deviceSerialNumber: string; activityCode: string; branchAddress: Record<string, string | null> };
  buyer: { type: 'P' | 'B' | 'F'; name: string | null; idLast4: string | null; mobileNumber: string | null };
  lines: ReceiptLine[]; totals: Totals;
  eta: { status: EtaStatus; statusChangedAt: string; submissionUuid: string | null; longId: string | null; attempts: number; lastError?: { code: string | null; message: string | null; details?: unknown }; history: Array<{ at: string; from: string | null; to: string; reason: string }> };
  registration: { officiallyRegistered: boolean; label: { en: string; ar: string }; qrContent: string | null };
}
export interface Payment { id: string; direction: 'IN' | 'OUT'; method: PaymentMethod; amount: string; tendered: string | null; change: string | null; status: string; reference: string | null; recordedAt: string }
export interface ReceiptDetail extends Receipt { payments: Payment[]; returnReceipts: Array<Pick<Receipt, 'id' | 'receiptNumber' | 'uuid' | 'dateTimeIssued'> & { totals: { totalAmount: string }; eta: { status: EtaStatus } }> }

export interface Shift { id: string; deviceId: string; branchId: string; cashierId: string; status: 'OPEN' | 'CLOSED'; openedAt: string; closedAt: string | null; openingCash: string; countedCash?: string; expectedCash?: string; variance?: string; cashIn?: string; cashOut?: string; live?: { expected: string; cashIn: string; cashOut: string } }

export interface CheckoutResult { replayed: boolean; receipt: Receipt; change: string }

export interface ReturnRecord {
  id: string; branchId: string; originalReceiptId: string; status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'COMPLETED'; reason: string; lines: Array<{ lineNo: number; quantity: string }>;
  refundMethod: PaymentMethod; refundReference: string | null; estimatedRefund: string; requiresApprovalReasons: string[]; requestedBy: string; createdAt: string; returnReceiptId: string | null;
}

export interface Company {
  id: string; legalName: string; tradeName: string; taxRegistrationNumber: string; activityCode: string; status: string;
  settings: { currency: string; timezone: string; enabledPaymentMethods: PaymentMethod[]; requireCardAuthorizationRef: boolean; buyerIdentityThreshold: string; returnWindowDays: number; returnApprovalAmount: string; returnApprovalAfterDays: number; maxCashierDiscountPercent: string };
  eta: { onboardingStatus: string; b2cTagConfirmed: boolean; submissionEnabled: boolean; notes: string | null };
}

export interface Dashboard {
  period: { from: string; to: string; timezone: string };
  sales: { receiptCount: number; grossSales: string; discounts: string; netSalesExcludingTax: string; totalIncludingTax: string };
  returns: { receiptCount: number; totalIncludingTax: string; netAmountExcludingTax: string };
  netRevenueIncludingTax: string;
  taxByType: Array<{ taxType: string; netAmount: string }>;
  byBranch: Array<{ id: string; name: string; salesCount: number; sales: string; returns: string; net: string }>;
  byDevice: Array<{ id: string; name: string; salesCount: number; sales: string; returns: string; net: string }>;
  daily: Array<{ day: string; receiptCount: number; sales: string; returns: string }>;
  payments: Array<{ direction: 'IN' | 'OUT'; method: PaymentMethod; status: string; count: number; amount: string }>;
  eta: { byStatus: Partial<Record<EtaStatus, number>>; openWork: Array<{ status: EtaStatus; count: number; oldestSince: string }>; lastSubmission: { status: string; sentAt: string; environment: string } | null };
  recentReceipts: Array<{ id: string; receiptNumber: string; kind: 'SALE' | 'RETURN'; dateTimeIssued: string; totalAmount: string; etaStatus: EtaStatus }>;
  integrationProblems: Array<{ id: string; receiptNumber: string; kind: string; etaStatus: EtaStatus; since: string; error: string | null }>;
}

export interface AuditEvent { id: string; at: string; action: string; outcome: 'success' | 'failure'; entityType: string | null; entityId: string | null; summary: string | null; actor: { userId: string | null; role: string | null; type: string }; changes: unknown }

export interface EtaStatusInfo {
  environment: string; configuredEnvironment: string; signingMode: string; simulated: boolean;
  onboarding: Company['eta']; receiptsByStatus: Array<{ status: EtaStatus; count: number; oldestSince: string }>; recentSubmissions: Array<{ _id: string; status: string; sentAt: string; httpStatus: number | null; errorCode: string | null; acceptedCount: number; rejectedCount: number }>; warnings: string[];
}
