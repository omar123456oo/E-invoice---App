# Database design

MongoDB 7 as a **replica set** (multi-document transactions are required for
checkout, returns and tax-rule versioning). Collections are scoped by `tenantId`
unless noted; a tenant-guard plugin rejects queries on scoped collections that do
not filter by `tenantId`. All money and quantities are `Decimal128`.

| Collection | Purpose | Key fields | Indexes (beyond `_id`) |
|---|---|---|---|
| tenants | Company, tax identity, settings, ETA onboarding flags | taxRegistrationNumber, settings.*, eta.* | `taxRegistrationNumber` unique |
| branches | Registered branches | etaBranchCode, address (ETA branchAddress) | `(tenantId, etaBranchCode)` unique |
| users | Accounts, role, branch assignments, MFA | email, role, branchIds, passwordHash (hidden), mfa.secretEnc (hidden, encrypted) | `email` unique; `(tenantId, role)` |
| sessions | Login sessions, hashed refresh token, rotation history | `_id` session id, refreshTokenHash, previousTokenHashes (max 20) | `refreshTokenHash` unique; `previousTokenHashes`; TTL on `expiresAt` +30 d |
| passwordResets | Single-use reset tokens (hashed) | tokenHash, expiresAt, usedAt | `tokenHash` unique; TTL |
| posDevices | ETA POS, credentials (encrypted, hidden), receipt chain, submission lease | serialNumber, code, chain.{seq,lastUuid,lastIssuedAt}, etaLock | `(tenantId, serialNumber)` unique; `(tenantId, branchId, code)` unique |
| cashierShifts | Opening float, counted cash, variance | status, openingCash, expectedCash, variance | one OPEN per device and per cashier (partial unique) |
| taxConfigurations | Versioned tax rules with verification source | code, version, etaTaxType, etaSubType, treatment, rate, effectiveFrom/To | `(tenantId, code, version)` unique; `(tenantId, code, effectiveFrom)` |
| products | Catalogue and official item codes | internalCode, barcode, etaItemType, etaItemCode, etaCodeStatus, unitPrice, taxCodes | `(tenantId, internalCode)` unique; `(tenantId, barcode)` unique partial |
| customers | Optional buyer profiles | buyerType, identityEnc/identityHash (hidden), identityLast4 | `(tenantId, identityHash)` unique partial; mobile; name |
| salesTransactions | Business sale event, idempotency | idempotencyKey, requestHash, status, totals paid/refunded | `(tenantId, idempotencyKey)` unique; `(tenantId, branchId, completedAt)` |
| receipts | Issued sale/return receipts (immutable snapshot) + ETA state | uuid, previousUUID, referenceUUID, chainSeq, lines[≤300], totals, etaDocumentEnc (hidden), eta.* | `(tenantId, uuid)` unique; `(tenantId, branchId, receiptNumber)` unique; `(tenantId, deviceId, chainSeq)` unique; `(tenantId, eta.status, deviceId, chainSeq)`; submissionUuid partial |
| payments | Money in (sales) and out (refunds) | direction, method, amount, status, reference | `(tenantId, shiftId, method)`; `(tenantId, transactionId)`; `(tenantId, branchId, recordedAt)` |
| returns | Return requests and approvals | status, lines, refundMethod, requiresApprovalReasons | `(tenantId, idempotencyKey)` unique; `(tenantId, originalReceiptId)` |
| etaSubmissions | One record per HTTP submission attempt | status, requestHash, submissionUuid, httpStatus, counts | `(tenantId, sentAt)`; `(tenantId, submissionUuid)` |
| auditEvents | Append-only hash chain | chainKey, seq, prevHash, hash, action, changes (redacted) | `(chainKey, seq)` unique; `(tenantId, at)`; entity; action |

## Immutability

- **Receipts**: a pre-update hook rejects `$set`/`$unset` on issued paths
  (`uuid`, `lines`, `totals`, `seller`, `buyer`, `etaDocumentEnc`, …), except
  `lines.N.returnedQuantity`. Deletes are rejected. ETA processing changes only `eta.*`.
- **Tax rules**: never edited in place; a new version closes the previous one. Deletes are rejected.
- **Audit events**: updates and deletes are rejected by hooks; tampering through
  direct database access is detected by `GET /audit-events/verify`.

## Bounded arrays

Receipt lines (≤300, the ETA maximum), `eta.history` (last 50), session token
history (last 20). Everything that grows without bound (payments, submissions,
audit events) is its own collection.

## Transactions

| Operation | Documents written atomically |
|---|---|
| Checkout | posDevices.chain (CAS), receipts, salesTransactions, payments, customer.lastPurchaseAt, auditEvents |
| Complete return | posDevices.chain, receipts (return), original receipt returnedQuantity, payments (OUT), salesTransactions, returns, auditEvents |
| New tax version | previous version `effectiveTo`, new version, auditEvents |
| Create tenant | tenant, owner user, auditEvents |

## Migrations and indexes

There is no migration framework yet. Indexes are created by Mongoose
(`autoIndex` is disabled in production); run `syncIndexes()` from a release
step (the dev seed script shows how). Record every schema change in this file.

## Retention

Not implemented yet (see known limitations KL-09). Sessions and reset tokens expire via TTL indexes.
