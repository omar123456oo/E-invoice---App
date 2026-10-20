# Backend API inventory

Generated on 2026-10-19 from the OpenAPI document the running API serves (`GET /api/v1/openapi.json`), which is built from the same Zod schemas that validate requests, so it matches the implementation. Cross-checked against the path literals in `apps/web/src`. 85 operations on 74 paths.

**Compatibility rules for every endpoint below**

- Paths, methods, field names and success status codes are a contract with the Angular app (`apps/web`) and any POS client. Do not rename or remove them; add new optional fields or new endpoints instead.
- Errors always use `{ "error": { "code", "message", "requestId", "details[] } }`. Clients branch on `error.code`, so codes are part of the contract too.
- List endpoints marked with `page`/`pageSize` return `{ items, page, pageSize, total, totalPages }`. The four unpaginated lists (users, branches, POS devices, tax rules) return a bare array and must keep doing so unless a versioned change is agreed.
- `Idempotency-Key` endpoints must keep returning the original result when a key is replayed.
- Monetary and quantity values are decimal **strings** in requests and responses, never JSON numbers.
- `*` marks a required body field. "Web" says whether the Angular app calls the endpoint; "no" does not mean unused (POS clients, scripts and operators may call it).

Health endpoints outside `/api/v1`: `GET /health/live` (process up), `GET /health/ready` (MongoDB connected). Docs: `GET /api/docs` (Swagger UI, not in production), `GET /api/v1/openapi.json`.

## Audit

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/audit-events` | permission `audit:read` | page, pageSize, action, entityType, entityId, from, to | – | – | 200 4XX | yes |
| GET | `/api/v1/audit-events/verify` | permission `audit:read` | – | – | – | 200 4XX | yes |

## Auth

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| POST | `/api/v1/auth/login` | public | – | – | email*, password*, totp | 200 4XX | yes |
| POST | `/api/v1/auth/refresh` | public | – | – | – | 200 4XX | yes |
| POST | `/api/v1/auth/logout` | any signed-in user (self-scoped) | – | – | – | 200 4XX | yes |
| GET | `/api/v1/auth/me` | any signed-in user (self-scoped) | – | – | – | 200 4XX | yes |
| GET | `/api/v1/auth/sessions` | any signed-in user (self-scoped) | – | – | – | 200 4XX | yes |
| DELETE | `/api/v1/auth/sessions/{sessionId}` | any signed-in user (self-scoped) | – | – | – | 200 4XX | yes |
| POST | `/api/v1/auth/password/change` | any signed-in user (self-scoped) | – | – | currentPassword*, newPassword* | 200 4XX | yes |
| POST | `/api/v1/auth/password/forgot` | public | – | – | email* | 202 4XX | yes |
| POST | `/api/v1/auth/password/reset` | public | – | – | token*, newPassword* | 200 4XX | yes |
| POST | `/api/v1/auth/mfa/setup` | any signed-in user (self-scoped) | – | – | – | 200 4XX | yes |
| POST | `/api/v1/auth/mfa/confirm` | any signed-in user (self-scoped) | – | – | code* | 200 4XX | yes |
| POST | `/api/v1/auth/mfa/disable` | any signed-in user (self-scoped) | – | – | password*, code* | 200 4XX | yes |

## Branches

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/branches` | permission `branches:read` | – | – | – | 200 4XX | yes |
| POST | `/api/v1/branches` | permission `branches:manage` | – | – | name*, etaBranchCode*, activityCode, address*, phone, isActive | 201 4XX | yes |
| PATCH | `/api/v1/branches/{id}` | permission `branches:manage` | – | – | name, etaBranchCode, activityCode, address, phone, isActive | 200 4XX | yes |

## Company

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/company` | permission `company:read` | – | – | – | 200 4XX | yes |
| PATCH | `/api/v1/company` | permission `company:manage` | – | – | legalName, tradeName, activityCode, commercialRegistrationNumber, contact, settings, eta | 200 4XX | yes |

## Customers

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/customers` | permission `customers:read` | page, pageSize, q, identity | – | – | 200 4XX | yes |
| POST | `/api/v1/customers` | permission `customers:manage` | – | – | buyerType*, name, identity, mobileNumber, email, marketingConsent, notes | 201 4XX | yes |
| POST | `/api/v1/customers/{id}/anonymize` | permission `customers:manage` | – | – | – | 200 4XX | yes |

## ETA

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/eta/status` | permission `eta:read` | – | – | – | 200 4XX | yes |
| GET | `/api/v1/eta/submissions` | permission `eta:read` | page, pageSize, deviceId, status | – | – | 200 4XX | no |
| POST | `/api/v1/eta/process` | permission `eta:manage` | – | – | – | 200 4XX | yes |

## Imports

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/imports/templates/products.csv` | permission `imports:read` | – | – | – | 200 4XX | yes |
| POST | `/api/v1/imports/uploads` | permission `imports:manage` | – | – | multipart: file*, purpose* | 201 4XX | yes |
| GET | `/api/v1/imports` | permission `imports:read` | page, pageSize, status | – | – | 200 4XX | yes |
| GET | `/api/v1/imports/{id}` | permission `imports:read` | – | – | – | 200 4XX | yes |
| GET | `/api/v1/imports/{id}/rows` | permission `imports:read` | page, pageSize, invalidOnly | – | – | 200 4XX | yes |
| POST | `/api/v1/imports/{id}/commit` | permission `products:manage` | – | – | allowPartial | 200 4XX | yes |
| POST | `/api/v1/imports/{id}/review` | permission `imports:manage` | – | – | documentNumber*, issueDate*, sellerName*, sellerTaxId, buyerName, buyerTaxId, currency, lines*, statedTotals*, acceptDifferences, notes | 200 4XX | yes |
| POST | `/api/v1/imports/{id}/retry` | permission `imports:manage` | – | – | – | 200 4XX | yes |
| POST | `/api/v1/imports/{id}/reject` | permission `imports:manage` | – | – | reason* | 200 4XX | yes |
| GET | `/api/v1/imports/uploads/{id}/file` | permission `imports:read` | – | – | – | 200 4XX | yes |

## Internal

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/internal/cron/sweep` | `Authorization: Bearer $CRON_SECRET` (Vercel Cron), no user session | – | – | – | 200 4XX | no |

## Notifications

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/notifications` | any signed-in user (self-scoped) | page, pageSize, unread | – | – | 200 4XX | yes |
| GET | `/api/v1/notifications/unread-count` | any signed-in user (self-scoped) | – | – | – | 200 4XX | yes |
| POST | `/api/v1/notifications/{id}/read` | any signed-in user (self-scoped) | – | – | – | 200 4XX | yes |
| POST | `/api/v1/notifications/read-all` | any signed-in user (self-scoped) | – | – | – | 200 4XX | yes |

## POS

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/pos-devices` | permission `pos:devices:read` | branchId | – | – | 200 4XX | yes |
| POST | `/api/v1/pos-devices` | permission `pos:devices:manage` | – | – | branchId*, name*, code*, serialNumber*, osVersion*, modelFramework* | 201 4XX | yes |
| PATCH | `/api/v1/pos-devices/{id}/status` | permission `pos:devices:manage` | – | – | status* | 200 4XX | yes |
| PUT | `/api/v1/pos-devices/{id}/eta-credentials` | permission `eta:manage` | – | – | clientId*, clientSecret*, presharedKey | 200 4XX | yes |
| GET | `/api/v1/pos/shifts/current` | permission `pos:shifts:operate` | – | – | – | 200 4XX | yes |
| POST | `/api/v1/pos/shifts` | permission `pos:shifts:operate` | – | – | deviceId*, openingCash* | 201 4XX | yes |
| GET | `/api/v1/pos/shifts` | permission `payments:read` | page, pageSize, branchId, status | – | – | 200 4XX | yes |
| POST | `/api/v1/pos/shifts/{id}/close` | permission `pos:shifts:operate` | – | – | countedCash*, notes | 200 4XX | yes |
| POST | `/api/v1/pos/quote` | permission `sales:checkout` | – | – | items*, extraDiscount | 200 4XX | yes |
| POST | `/api/v1/pos/checkout` | permission `sales:checkout` | – | Idempotency-Key | deviceId*, items*, extraDiscount, customerId, buyer, payments* | 201 4XX | yes |

## Platform

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| POST | `/api/v1/platform/tenants` | permission `platform:tenants:manage` | – | – | legalName*, tradeName*, taxRegistrationNumber*, activityCode*, contact, owner* | 201 4XX | no |
| GET | `/api/v1/platform/tenants` | permission `platform:tenants:manage` | – | – | – | 200 4XX | no |
| PATCH | `/api/v1/platform/tenants/{id}/status` | permission `platform:tenants:manage` | – | – | status* | 200 4XX | no |

## Products

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/products` | permission `products:read` | page, pageSize, q, active | – | – | 200 4XX | yes |
| POST | `/api/v1/products` | permission `products:manage` | – | – | kind*, internalCode*, barcode, nameAr*, nameEn, description*, etaItemType*, etaItemCode*, unitType*, unitPrice*, taxCodes*, isActive | 201 4XX | yes |
| GET | `/api/v1/products/barcode/{barcode}` | permission `products:read` | – | – | – | 200 4XX | yes |
| GET | `/api/v1/products/{id}` | permission `products:read` | – | – | – | 200 4XX | yes |
| PATCH | `/api/v1/products/{id}` | permission `products:manage` | – | – | kind, internalCode, barcode, nameAr, nameEn, description, etaItemType, etaItemCode, unitType, unitPrice, taxCodes, isActive, etaCodeStatus | 200 4XX | yes |
| POST | `/api/v1/products/bulk` | permission `products:manage` | – | – | dryRun, rows* | 200 4XX | no |

## Receipts

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/receipts` | permission `receipts:read` | page, pageSize, branchId, deviceId, kind, etaStatus, receiptNumber, uuid, from, to | – | – | 200 4XX | yes |
| GET | `/api/v1/receipts/{id}` | permission `receipts:read` | – | – | – | 200 4XX | yes |
| POST | `/api/v1/receipts/{id}/print` | permission `receipts:reprint` | – | – | – | 200 4XX | yes |
| POST | `/api/v1/receipts/{id}/submit` | permission `receipts:submit` | – | – | reason | 200 4XX | yes |
| POST | `/api/v1/receipts/{id}/correct` | permission `receipts:submit` | – | – | reason*, useCurrentProductCodes, lines, buyer | 201 4XX | yes |
| POST | `/api/v1/receipts/{id}/reconcile` | permission `receipts:submit` | – | – | – | 200 4XX | yes |

## Reports

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/reports/dashboard` | permission `reports:read` | from, to, branchId, format | – | – | 200 4XX | yes |
| GET | `/api/v1/reports/sales-by-product` | permission `reports:read` | from, to, branchId, format | – | – | 200 4XX | yes |
| GET | `/api/v1/reports/sales-by-cashier` | permission `reports:read` | from, to, branchId, format | – | – | 200 4XX | yes |
| GET | `/api/v1/reports/tax-summary` | permission `reports:read` | from, to, branchId, format | – | – | 200 4XX | yes |
| GET | `/api/v1/reports/refunds` | permission `reports:read` | from, to, branchId, format | – | – | 200 4XX | yes |
| GET | `/api/v1/reports/eta-processing` | permission `reports:read` | from, to, branchId, format | – | – | 200 4XX | yes |
| GET | `/api/v1/reports/shift-reconciliation` | permission `reports:read` | from, to, branchId, format | – | – | 200 4XX | yes |

## Returns

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/returns` | permission `returns:read` | page, pageSize, status, branchId | – | – | 200 4XX | yes |
| POST | `/api/v1/returns` | permission `returns:create` | – | Idempotency-Key | originalReceiptId*, lines*, reason*, refundMethod*, refundReference | 201 4XX | yes |
| POST | `/api/v1/returns/{id}/decision` | permission `returns:approve` | – | – | approve*, notes | 200 4XX | yes |
| POST | `/api/v1/returns/{id}/complete` | permission `returns:create` | – | – | deviceId* | 200 4XX | yes |

## Sales

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/sales-transactions` | permission `sales:read` | page, pageSize, branchId, from, to | – | – | 200 4XX | no |

## Tax

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/tax-configurations` | permission `tax:read` | code, activeAt | – | – | 200 4XX | yes |
| POST | `/api/v1/tax-configurations` | permission `tax:manage` | – | – | code*, name*, etaTaxType*, etaSubType*, treatment*, rate*, effectiveFrom*, verification* | 201 4XX | yes |
| GET | `/api/v1/tax-configurations/policy` | permission `tax:read` | – | – | – | 200 4XX | no |
| POST | `/api/v1/tax-configurations/{code}/retire` | permission `tax:manage` | – | – | effectiveTo* | 200 4XX | no |

## Users

| Method | Path | Access | Query | Headers | Body | Status codes | Web |
|---|---|---|---|---|---|---|---|
| GET | `/api/v1/users` | permission `users:read` | – | – | – | 200 4XX | yes |
| POST | `/api/v1/users` | permission `users:manage` | – | – | name*, email*, password*, role*, branchIds, locale | 201 4XX | yes |
| PATCH | `/api/v1/users/{id}` | permission `users:manage` | – | – | name, role, branchIds, isActive | 200 4XX | yes |
| POST | `/api/v1/users/{id}/revoke-sessions` | permission `users:manage` | – | – | – | 200 4XX | yes |
