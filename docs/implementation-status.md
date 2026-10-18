# Implementation status

Last updated: 2026-10-18. "Done" follows the Definition of Done in the project
brief (documented, functional backend, connected UI, persistence, server-side
permissions, validation, passing tests, user docs, limitations recorded).

## Phase summary

| Phase | Status |
|---|---|
| 1. Repository audit and requirements | Done. The directory was empty, so a new monorepo was created; requirements are tracked here and in compliance-matrix.md |
| 2. Architecture and data model | Done (architecture.md, database-design.md, receipt-lifecycle.md, openapi.json) |
| 3. Foundation | Done: config validation, logging, errors, auth, RBAC, tenancy, audit, tests, CI definition |
| 4. Core business | Done: products, customers, POS, calculation, receipts, payments, shifts, dashboard, reports |
| 5. ETA integration | Done as far as possible without external access: adapter, submission, polling, reconciliation, corrections, alerts, tested against the simulated ETA. **Blocked**: issuer signing (KL-01) and the preprod verification run (KL-02) need the taxpayer's signing device and ETA test credentials |
| 6. Returns, imports, advanced | Done: returns and refunds, import centre with review, notifications and email outbox, background jobs. OCR provider not bundled (KL-10) |
| 7. Release readiness | Partial: unit, integration and browser end-to-end tests pass; access control and tenant isolation are tested. Not done: ETA preprod run, restore test, executing the Docker/CI artefacts (no Docker on the development machine) |

## Module matrix

| Module (brief §5) | Backend | UI | Tests | Status |
|---|---|---|---|---|
| A Authentication and access control | Login, lockout, MFA (enrol/confirm/disable), sessions, rotation, reset, RBAC, branch restriction, login history | Login, reset, My account (password, MFA, sessions), users | auth.test.ts, guards.spec.ts | Done |
| B Company and branches | Tenants, settings, branches, devices, credentials | Company, branches, devices | auth, eta tests | Done |
| C Dashboard | Aggregations from persisted receipts/payments | Dashboard | audit-reports.test.ts | Done |
| D Products | CRUD, barcode lookup, search, bulk and file import, change history | List, form, import centre | imports, audit-reports | Done |
| E Customers | Optional profiles, encrypted identity, duplicate detection, anonymisation | Customers page | checkout, e2e | Done |
| F POS | Quote, checkout, idempotency, shifts, reprint control | POS, shifts | checkout.test.ts, e2e | Done |
| G Receipt lifecycle | Issuance, chain, state machine, reconciliation, corrections | Receipt list/detail, stamp, correction dialog | checkout, eta-lifecycle, corrections | Done (preprod verification pending) |
| H ETA adapter | Auth, documents, serializer, submission, poll, reconcile, health, logs | Tax Authority link page | eta tests | Partial: signing and ETA→ERP notifications blocked/external |
| I Returns and refunds | Requests, approvals, return receipts, refunds, drawer check | Returns pages | returns.test.ts | Done |
| J Payments and cash | Payments, split tender, refunds, reconciliation | POS, shifts, receipt detail, shift report | checkout, returns, reports | Done (provider adapter pending, KL-19) |
| K Upload and import centre | Validation, scanning, private storage, de-duplication, background processing, row errors, review, retry, history | Import centre list/detail | imports.test.ts, e2e | Done (OCR provider not bundled) |
| L Reporting and export | Dashboard + 6 reports, CSV and Excel | Dashboard, reports page | reports.test.ts, e2e | Done (no PDF, KL-18) |
| M Notifications and jobs | In-app + email outbox, retries, dead-letter, alerts, admin retry | Notifications page and counter | notifications.test.ts | Done |
| N Audit and administration | Hash-chained audit, verification, tax versioning, settings | Audit, users | audit-reports | Done (retention pending legal input, KL-09) |

## Requirements matrix (brief → implementation)

| Brief requirement | Where | Status |
|---|---|---|
| Never present internal receipts as registered | receipt-view.ts, receipt-print.ts, eta-stamp.ts | Done |
| Separate internal and ETA status | receipt.model.ts `eta`, sales-transaction status | Done |
| No blind resubmission after timeout | eta-integration.service.ts | Done |
| Corrections only through supported procedures | correction.service.ts (referenceOldUUID, 96 h) | Done |
| Decimal arithmetic, server-side totals | money/decimal.ts, tax/calculation.ts | Done |
| Tax config versioning with snapshot | tax-configuration.model.ts, receipt lines `ruleCode/ruleVersion` | Done |
| No single hard-coded tax rate | tax rules are tenant data with verification source | Done |
| Tenant isolation in every query | services + tenant-guard.ts | Done |
| Secrets never in frontend/logs/responses | crypto.ts, logger redaction, select:false, tests | Done |
| OCR data untrusted, totals recalculated, no receipts from uploads | import.service.ts | Done |
| OpenAPI contract | openapi.json generated from routes (84 operations) | Done |
| Arabic/English with RTL | i18n service, logical CSS | Done |
| Docker Compose, CI | docker-compose.yml, ci.yml | Written, not executed here (KL-17) |

## What remains, and who it depends on

1. **ETA preprod verification** — needs ETA test credentials and a registered POS from the taxpayer (eta-integration.md checklist).
2. **Issuer signing** — needs the signing device/e-seal and ETA's signing specification.
3. **Tax and legal review** — rates, rounding, retention, buyer rules, PDPL (compliance matrix U-07 to U-09).
4. **Infrastructure run** — execute Docker/CI, configure SMTP and ClamAV, run a restore test.
