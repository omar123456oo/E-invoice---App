# Compliance matrix

Review date for every ETA source below: **2026-10-18**. The ETA SDK release-notes
index listed **Aug 2023 (22-08-2023)** as its most recent entry on that date.
Re-review all sources before each release; ETA pages change without version numbers.

Status values: **Implemented** (code + automated test), **Partial**, **Not implemented**,
**External** (depends on something outside this codebase), **Unverified** (implemented
as a configurable assumption that has not been confirmed from an official source).

Automated tests use the **simulated ETA** test double. They prove our handling of
documented responses. They do **not** prove acceptance by ETA. Every row marked
"needs preprod" must be verified in https://sdk.preprod.invoicing.eta.gov.eg/ with
real taxpayer test credentials before production.

## 1. Verified ETA requirements

| ID | Requirement (as documented) | Official source | Module | Status | Test evidence | Outstanding dependency |
|---|---|---|---|---|---|---|
| ETA-001 | Receipt v1.2 structure: `header` object; `documentType`, `seller`, `buyer`, `itemData[]` and totals at document root; `receiptType` "s", `typeVersion` "1.2" | [Receipt v1.2](https://sdk.invoicing.eta.gov.eg/documents/receipt-v1-2/) | eta/receipt-document.ts | Implemented | receipt-document.test.ts | Needs preprod acceptance |
| ETA-002 | Return receipt v1.2: `receiptType` "r", mandatory `referenceUUID` of the sale receipt | [Return receipt v1.2](https://sdk.invoicing.eta.gov.eg/documents/return-receipt-v1-2/) | eta/receipt-document.ts, returns | Implemented | receipt-document.test.ts, returns.test.ts | Needs preprod acceptance |
| ETA-003 | UUID = SHA-256 over the serialized document with empty `uuid`, hex 64 chars | [Receipt Issuance FAQ](https://sdk.invoicing.eta.gov.eg/receiptissuancefaq/), [Serialization approach](https://sdk.invoicing.eta.gov.eg/document-serialization-approach/) | eta/serializer.ts, receipt-document.ts | Implemented | serializer.test.ts matches the official `one-doc` golden sample byte for byte | Hex letter case not specified (see U-01) |
| ETA-004 | `previousUUID` = UUID of the previous receipt from the same POS; empty only for the first | Receipt v1.2 | receipts/issuance.service.ts | Implemented | checkout.test.ts (chain, concurrency) | — |
| ETA-005 | `receiptNumber` String(50), unique per branch | Receipt v1.2 | issuance.service.ts, unique index | Implemented | checkout.test.ts | — |
| ETA-006 | `dateTimeIssued` UTC, valid, not in the future | Receipt v1.2, FAQ rules 11–12 | issuance.service.ts | Implemented | receipt-document.test.ts | Server clock must be NTP-synchronised (deployment) |
| ETA-007 | Submit within the allowed duration (24 hours) unless resubmitting with ReferenceOldUUID | FAQ | eta-integration.service.ts, sweeper | Partial | — | No alert yet for receipts approaching 24 h unsent (KL-07) |
| ETA-008 | Max 500 receipts / 1.5 MB per submission; min 1; max 300 lines per receipt | FAQ | eta-integration.service.ts (100 / 1.4 MB), tax/calculation.ts (300) | Implemented | calculation.test.ts | — |
| ETA-009 | All receipts in one submission from the same POS | FAQ rule 24 | eta-integration.service.ts (per-device batches) | Implemented | eta-lifecycle.test.ts | — |
| ETA-010 | Authenticate POS: POST `{identity}/connect/token`, `grant_type=client_credentials`, headers `posserial`, `pososversion`, `posmodelframework`, `presharedkey`; token ≈1 h | [01 Authenticate POS](https://sdk.invoicing.eta.gov.eg/ereceiptapi/01-authenticate-pos/) | eta/eta-http-client.ts, token-manager.ts | Implemented | eta-http-client.test.ts | Body encoding not stated (U-02); needs preprod |
| ETA-011 | Submit: POST `/api/v1/receiptsubmissions`, JSON only, HTTP 202 with `submissionUUID`, `acceptedDocuments[uuid,longId,receiptNumber]`, `rejectedDocuments[...error]` | [02 Submit receipt](https://sdk.invoicing.eta.gov.eg/ereceiptapi/02-submit-receipt/) | eta-integration.service.ts | Implemented | eta-lifecycle.test.ts | Needs preprod |
| ETA-012 | 400 BadStructure / MaximumSizeExceeded, 403 IncorrectSubmitter, 422 DuplicateSubmission (identical payload within 10 min, `Retry-After`) | 02 Submit receipt | eta-integration.service.ts | Implemented (FAILED / UNKNOWN+reconcile) | eta-lifecycle.test.ts, eta-http-client.test.ts | — |
| ETA-013 | Get submission: GET `/api/v1/receiptsubmissions/{uuid}/details`, `PageNo`, `PageSize`; overall `InProgress/Valid/Invalid`; document `Valid/Invalid/Cancelled` | [06 Get receipt submission](https://sdk.invoicing.eta.gov.eg/ereceiptapi/06-get-receipt-submission/) | pollSubmission | Implemented | eta-lifecycle.test.ts | Needs preprod |
| ETA-014 | Get receipt details: GET `/api/v1/receipts/{uuid}/details`; issuers see valid and cancelled receipts | [03 Get receipt details](https://sdk.invoicing.eta.gov.eg/ereceiptapi/03-get-receipt-details/) | reconcileReceipt | Implemented | eta-lifecycle.test.ts | Behaviour for invalid receipts not documented (U-06) |
| ETA-015 | Base URLs: identity `id.preprod.eta.gov.eg` / `id.eta.gov.eg`; API `api.preprod.invoicing.eta.gov.eg` / `api.invoicing.eta.gov.eg` | [FAQ](https://sdk.invoicing.eta.gov.eg/faq/) | config/env.ts | Implemented | env.test.ts | — |
| ETA-016 | Buyer: B needs RIN + name; P needs national ID + name when total ≥ configured value (150,000 EGP at review); F id is any foreign ID | Receipt v1.2 | checkout.service.ts, tenant settings | Implemented (threshold configurable) | checkout.test.ts | Confirm threshold before go-live |
| ETA-017 | Return receipt at most 540 days after the sale | FAQ | returns, tenant setting (≤540) | Implemented | returns.test.ts | — |
| ETA-018 | Return `referenceUUID` must be a receipt of the original type | FAQ rule 26 | returns | Implemented; returns are sent only after the sale is VALID (assumption A-05) | returns.test.ts | — |
| ETA-019 | Correction: new UUID, same previousUUID, `referenceOldUUID` = invalid UUID; within 96 h (with reference) / 72 h | FAQ | — | Not implemented | — | KL-03 |
| ETA-020 | Payment method codes C, V, CC, VC, VO, PR, GC, P, O | [Payment methods](https://sdk.invoicing.eta.gov.eg/codes/payment-methods/) | ETA_PAYMENT_CODES | Implemented (subset) | payment-rules.test.ts | Contractor codes CC/VC not supported; mapping assumption A-03 |
| ETA-021 | Tax types T1–T20 and sub-types (e.g. V001–V010) | [Tax types](https://sdk.invoicing.eta.gov.eg/codes/tax-types/) | tax module | Partial: T1 percentage and exempt only | calculation.test.ts | Other treatments refused until reviewed (KL-04) |
| ETA-022 | `taxType` unique within a line; `taxableItem.amount` precision 2 | Receipt v1.2 | calculation.ts | Implemented | calculation.test.ts | — |
| ETA-023 | `itemType` GS1 or EGS with `itemCode`; quantity > 0 | Receipt v1.2 | products, calculation | Implemented | calculation.test.ts | Code registration happens in ETA code management (external) |
| ETA-024 | `feesAmount` and `adjustment` reserved, zero only | Receipt v1.2 | receipt-document.ts | Implemented | receipt-document.test.ts | — |
| ETA-025 | `exchangeRate` mandatory when currency ≠ EGP | Receipt v1.2 | receipt-document.ts | Implemented; UI supports EGP only | — | — |
| ETA-026 | POS must be activated; only taxpayers with the B2C tag can submit | 02 Submit receipt | device status, tenant `b2cTagConfirmed` | Implemented as administrator-confirmed flags | tenant/company tests | Activation is an external ETA process |
| ETA-027 | `signatures`: Issuer CAdES-BES (Base64) required, Service Provider optional; signature validation "will not be deployed at this point" | 02 Submit receipt, FAQ | eta/signer.ts | **External / Not implemented** | env.test.ts (production refuses unsigned mode) | Signing device/certificate and exact signed content (U-03) |
| ETA-028 | ERP endpoints for receipt notifications, general notifications, package-ready notifications | [09](https://sdk.invoicing.eta.gov.eg/ereceiptapi/09-receive-receipt-notifications/), [10](https://sdk.invoicing.eta.gov.eg/ereceiptapi/10-receive-general-notifications/), [14](https://sdk.invoicing.eta.gov.eg/ereceiptapi/14-receive-download-package-notifications/) | — | Not implemented | — | Authentication of ETA→ERP calls not reviewed (U-05); polling is used instead |
| ETA-029 | Search, recent receipts, receipt packages APIs | [07](https://sdk.invoicing.eta.gov.eg/ereceiptapi/07-search-receipts/), 08, 11–13 | — | Not implemented | — | Not needed for the core lifecycle |

## 2. Implementation assumptions (not confirmed by an official source)

| ID | Assumption | Where | How to change |
|---|---|---|---|
| A-01 | Amounts are rounded to 2 dp, half-up, per line (`totalSale`, discounts, each tax); totals are sums of rounded lines | tax/calculation.ts `AMOUNT_SCALE`, `ROUNDING`, `POLICY_VERSION` | Change constants, bump `POLICY_VERSION`; issued receipts keep their version |
| A-02 | Unit prices are tax-exclusive | products, calculation | Tax-inclusive pricing is not supported (KL-05) |
| A-03 | Bank transfer and mobile wallet map to ETA code `O` (Others); card maps to `V` | eta/receipt-document.ts `ETA_PAYMENT_CODES` | Edit mapping |
| A-04 | With split tender the receipt `paymentMethod` is the method with the largest amount (ties: first) | payments/payment-rules.ts | Edit `primaryEtaPaymentCode` |
| A-05 | A return receipt is submitted only after its original sale is VALID at ETA | eta-integration.service.ts | Batch-building loop |
| A-06 | Property order in submitted JSON follows the order of the official field tables | receipt-document.ts | Must be confirmed by preprod acceptance |
| A-07 | Commercial discount reduces the taxable base; item discount is applied after tax; extra receipt discount does not reduce tax | calculation.ts | Matches field descriptions in receipt v1.2; confirm with tax professional |
| A-08 | An "unknown" submission is re-sent only when ETA reports the UUID as not found for longer than 15 min (10-min duplicate window + 5 min) | `RECONCILE_GRACE_MS` | Constant |

## 3. Unresolved legal and technical questions

| ID | Question | Owner | Impact |
|---|---|---|---|
| U-01 | Hex letter case of the receipt UUID (we use lowercase) | Integration engineer (preprod test) | Rejection if ETA requires uppercase |
| U-02 | Body encoding of `/connect/token` (we use `application/x-www-form-urlencoded`, the OAuth2 standard) | Integration engineer | Authentication failure |
| U-03 | Exact content to sign, signing certificate/e-seal and whether unsigned submissions are accepted in preprod/production today | Taxpayer + ETA | Production blocked until resolved |
| U-04 | Official QR code content for printed receipts | Integration engineer | QR not printed (configurable template `ETA_RECEIPT_QR_TEMPLATE`) |
| U-05 | How ETA authenticates calls to the ERP notification endpoints | Integration engineer | Notifications not implemented |
| U-06 | What Get Receipt Details returns for an INVALID receipt (affects reconciliation after timeouts) | Integration engineer | A resend after grace may be rejected as duplicate; visible to operators |
| U-07 | Applicable VAT and other tax rates per product category, exemptions and rounding | Qualified Egyptian tax professional | Tax rules are tenant data with mandatory verification source; no rate is hard-coded |
| U-08 | Legal retention period for receipts, payments and audit records | Tax professional / counsel | Retention jobs not implemented (KL-09) |
| U-09 | Applicability of Personal Data Protection Law No. 151 of 2020 and its executive regulations (consent, registration, cross-border hosting) | Qualified counsel | See security.md, privacy section |
| U-10 | Late-submission request process and parameter value | ETA | Operational procedure |
| U-11 | Whether a receipt's `buyer.type` P with only a mobile number needs further data | Tax professional | Currently allowed |

## 4. Production readiness statement

The platform is **not certified, approved or authorised by ETA**. It must not be
used to issue receipts in production until: ETA-027 signing is implemented, all
"needs preprod" rows pass in the ETA preprod environment with recorded evidence,
U-01 to U-03 and U-07 are resolved, and the taxpayer's B2C onboarding and POS
activation are complete.
