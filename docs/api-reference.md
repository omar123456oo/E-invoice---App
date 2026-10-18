# API reference

The authoritative contract is **[openapi.json](openapi.json)** (OpenAPI 3.1),
generated from the route definitions with `npm run openapi -w apps/api`. In
development, Swagger UI is served at `http://localhost:3000/api/docs`.

## Conventions

- Base path: `/api/v1`. JSON only, max body 1 MB.
- **Money and quantities are decimal strings** (`"114.00"`), never JSON numbers.
- Dates are ISO-8601 UTC.
- Authentication: `Authorization: Bearer <access token>` (15 min). Refresh with
  `POST /auth/refresh` using the httpOnly `rt` cookie and header `X-Requested-With: XMLHttpRequest`.
- Pagination: `?page=1&pageSize=25` (max 200); responses `{ items, page, pageSize, total, totalPages }`.
- Unknown body properties are dropped (no mass assignment).
- `Idempotency-Key` (16–64 chars `[A-Za-z0-9-]`) is **required** for
  `POST /pos/checkout` and `POST /returns`. Replaying a key returns the original
  result; reusing a key with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`.

## Errors

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Request validation failed", "requestId": "…", "details": [{ "path": "body.items.0.quantity", "message": "…", "code": "INVALID_QUANTITY" }] } }
```

| HTTP | Typical codes |
|---|---|
| 400 | MALFORMED_JSON, INVALID_VALUE |
| 401 | UNAUTHENTICATED, INVALID_CREDENTIALS, INVALID_TOKEN, SESSION_REVOKED, MFA_REQUIRED |
| 403 | FORBIDDEN, BRANCH_FORBIDDEN, ROLE_NOT_ASSIGNABLE, DISCOUNT_LIMIT_EXCEEDED, CSRF_HEADER_MISSING |
| 404 | NOT_FOUND, ROUTE_NOT_FOUND |
| 409 | DUPLICATE, IDEMPOTENCY_KEY_REUSED, SHIFT_ALREADY_OPEN, CHAIN_CONFLICT |
| 422 | VALIDATION_FAILED, BUYER_IDENTITY_REQUIRED, NO_OPEN_SHIFT, TAX_RULE_NOT_IN_FORCE, UNSUPPORTED_TAX_TREATMENT, ORIGINAL_NOT_RETURNABLE, RETURN_WINDOW_EXPIRED, INVALID_ETA_STATE |
| 423 | ACCOUNT_LOCKED |
| 429 | RATE_LIMITED |
| 500 | INTERNAL_ERROR (details never exposed; use `requestId` to find the log entry) |

## Endpoints

The last column is the permission the server enforces (see `security.md` for the role matrix).

| Method | Path | Summary | Permission |
|---|---|---|---|
| POST | `/api/v1/auth/login` | Sign in with email and password (and TOTP code when MFA is enabled) | public |
| POST | `/api/v1/auth/refresh` | Rotate the refresh-token cookie and obtain a new access token | public |
| POST | `/api/v1/auth/logout` | Revoke the current session | any signed-in user |
| GET | `/api/v1/auth/me` | Current user, permissions and branch access | any signed-in user |
| GET | `/api/v1/auth/sessions` | List my active sessions | any signed-in user |
| DELETE | `/api/v1/auth/sessions/{sessionId}` | Revoke one of my sessions | any signed-in user |
| POST | `/api/v1/auth/password/change` | Change my password (revokes other sessions) | any signed-in user |
| POST | `/api/v1/auth/password/forgot` | Request a password reset email | public |
| POST | `/api/v1/auth/password/reset` | Reset password using an emailed token | public |
| POST | `/api/v1/auth/mfa/setup` | Begin TOTP enrollment | any signed-in user |
| POST | `/api/v1/auth/mfa/confirm` | Confirm TOTP enrollment with a code | any signed-in user |
| POST | `/api/v1/platform/tenants` | Create a company (tenant) with its owner account | platform:tenants:manage |
| GET | `/api/v1/platform/tenants` | List companies | platform:tenants:manage |
| PATCH | `/api/v1/platform/tenants/{id}/status` | Suspend or reactivate a company | platform:tenants:manage |
| GET | `/api/v1/company` | Get my company profile and settings | company:read |
| PATCH | `/api/v1/company` | Update company profile, settings and ETA onboarding status | company:manage |
| GET | `/api/v1/branches` | List branches visible to me | branches:read |
| POST | `/api/v1/branches` | Register a branch | branches:manage |
| PATCH | `/api/v1/branches/{id}` | Update a branch | branches:manage |
| GET | `/api/v1/users` | List company users | users:read |
| POST | `/api/v1/users` | Create a user | users:manage |
| PATCH | `/api/v1/users/{id}` | Update role, branches, activation | users:manage |
| POST | `/api/v1/users/{id}/revoke-sessions` | Sign a user out everywhere | users:manage |
| GET | `/api/v1/pos-devices` | List POS devices | pos:devices:read |
| POST | `/api/v1/pos-devices` | Register a POS device | pos:devices:manage |
| PATCH | `/api/v1/pos-devices/{id}/status` | Change device status (ACTIVE after ETA activation is confirmed) | pos:devices:manage |
| PUT | `/api/v1/pos-devices/{id}/eta-credentials` | Store ETA POS credentials (encrypted at rest, write-only) | eta:manage |
| GET | `/api/v1/tax-configurations` | List tax rule versions | tax:read |
| POST | `/api/v1/tax-configurations` | Create a new tax rule version (requires verification source) | tax:manage |
| GET | `/api/v1/tax-configurations/policy` | Calculation policy and supported tax treatments | tax:read |
| POST | `/api/v1/tax-configurations/{code}/retire` | Close the open version of a tax rule | tax:manage |
| GET | `/api/v1/products` | Search products | products:read |
| POST | `/api/v1/products` | Create a product | products:manage |
| GET | `/api/v1/products/barcode/{barcode}` | Look up an active product by barcode | products:read |
| GET | `/api/v1/products/{id}` | Get a product | products:read |
| PATCH | `/api/v1/products/{id}` | Update a product (price/tax changes are audited) | products:manage |
| POST | `/api/v1/products/bulk` | Validate and import products; returns row-level errors (dryRun=true validates only) | products:manage |
| GET | `/api/v1/customers` | Search customers by name, mobile or exact identity number | customers:read |
| POST | `/api/v1/customers` | Create a customer profile (detects duplicates by identity number and mobile) | customers:manage |
| POST | `/api/v1/customers/{id}/anonymize` | Erase personal data from a profile (issued receipts keep their legally required snapshot) | customers:manage |
| GET | `/api/v1/pos/shifts/current` | My open shift, if any | pos:shifts:operate |
| POST | `/api/v1/pos/shifts` | Open a cashier shift on a device | pos:shifts:operate |
| GET | `/api/v1/pos/shifts` | Shift history with reconciliation figures | payments:read |
| POST | `/api/v1/pos/shifts/{id}/close` | Close a shift with a cash count (computes variance) | pos:shifts:operate |
| POST | `/api/v1/pos/quote` | Price a cart on the server without saving it | sales:checkout |
| POST | `/api/v1/pos/checkout` | Complete a sale and issue its receipt (requires Idempotency-Key header) | sales:checkout |
| GET | `/api/v1/sales-transactions` | List sales transactions | sales:read |
| GET | `/api/v1/receipts` | Search receipts | receipts:read |
| GET | `/api/v1/receipts/{id}` | Receipt detail with ETA status, errors and payments | receipts:read |
| POST | `/api/v1/receipts/{id}/print` | Record a (re)print and return printable data | receipts:reprint |
| POST | `/api/v1/receipts/{id}/submit` | Queue a receipt for ETA submission (or re-queue after a FAILED submission was fixed) | receipts:submit |
| POST | `/api/v1/receipts/{id}/reconcile` | Ask ETA for the status of a receipt whose submission outcome is unknown | receipts:submit |
| GET | `/api/v1/returns` | List returns | returns:read |
| POST | `/api/v1/returns` | Request a return against an original sale receipt (requires Idempotency-Key header) | returns:create |
| POST | `/api/v1/returns/{id}/decision` | Approve or reject a pending return | returns:approve |
| POST | `/api/v1/returns/{id}/complete` | Issue the return receipt and record the refund in the open shift | returns:create |
| GET | `/api/v1/reports/dashboard` | Dashboard figures for a period | reports:read |
| GET | `/api/v1/reports/sales-by-product` | Operational report: sales-by-product (json or csv). Not an official tax return. | reports:read |
| GET | `/api/v1/reports/sales-by-cashier` | Operational report: sales-by-cashier (json or csv). Not an official tax return. | reports:read |
| GET | `/api/v1/eta/status` | Integration configuration and health for my company | eta:read |
| GET | `/api/v1/eta/submissions` | Submission attempts log | eta:read |
| POST | `/api/v1/eta/process` | Run submission, polling and reconciliation now for my company | eta:manage |
| GET | `/api/v1/audit-events` | Search the audit trail | audit:read |
| GET | `/api/v1/audit-events/verify` | Verify the integrity of my company audit chain | audit:read |
Health checks (no auth): `GET /health/live`, `GET /health/ready` (MongoDB connectivity).
