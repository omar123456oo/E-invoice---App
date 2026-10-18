# Implementation status

Last updated: 2026-10-18. "Done" follows the Definition of Done in the project
brief (documented, functional backend, connected UI, persistence, server-side
permissions, validation, passing tests, user docs, limitations recorded).

## Phase summary

| Phase | Status |
|---|---|
| 1. Repository audit and requirements | Done: the directory was empty, so a new monorepo was created. Requirements are tracked in this file and in compliance-matrix.md |
| 2. Architecture and data model | Done (architecture.md, database-design.md, receipt-lifecycle.md, openapi.json) |
| 3. Foundation | Done: config validation, logging, errors, auth, RBAC, tenancy, audit, tests, CI definition |
| 4. Core business | Done for products, POS, calculation, receipts, payments, shifts, dashboard, reports. Customer UI missing (KL-14) |
| 5. ETA integration | Partial: adapter, submission, polling, reconciliation done and tested against the simulated ETA. Signing (KL-01), preprod verification (KL-02), corrections (KL-03) and notifications endpoints (KL-12) outstanding |
| 6. Returns, imports, advanced | Returns and refunds done. Import centre/OCR (KL-10) and email notifications (KL-08) not started |
| 7. Release readiness | Not started: no preprod run, no restore test, deployment artefacts not executed |

## Module matrix

| Module (brief §5) | Backend | UI | Tests | Status |
|---|---|---|---|---|
| A Authentication and access control | Login, lockout, MFA, sessions, rotation, reset, RBAC, branch restriction, login history | Login, reset, sign-out, users page | auth.test.ts | Done (MFA enrolment UI pending; API complete) |
| B Company and branches | Tenants, settings, branches, devices, credentials | Company, devices pages | auth, eta tests | Done; branch UI missing (KL-14) |
| C Dashboard | Aggregations from persisted receipts/payments | Dashboard | audit-reports.test.ts | Done |
| D Products | CRUD, barcode lookup, search, bulk validation/import, change history | List, form | auth, audit-reports | Done (file-based import pending, KL-10) |
| E Customers | Optional profiles, encrypted identity, duplicate detection, anonymisation | — | via checkout | Backend done; UI missing |
| F POS | Quote, checkout, idempotency, shifts, reprint control | POS page, shifts | checkout.test.ts | Done |
| G Receipt lifecycle | Issuance, chain, state machine, reconciliation | Receipt list/detail, stamp | checkout, eta-lifecycle | Done except corrections |
| H ETA adapter | Auth, documents, serializer, submission, poll, reconcile, health, logs | Tax Authority link page | eta tests | Partial (signing, notifications) |
| I Returns and refunds | Requests, approvals, return receipts, refunds | Returns pages | returns.test.ts | Done |
| J Payments and cash | Payments, split tender, refunds, reconciliation | POS, shifts, receipt detail | checkout, returns | Done (provider adapter pending) |
| K Upload and import centre | — | — | — | Not started |
| L Reporting and export | Dashboard, by product, by cashier, CSV | Dashboard | audit-reports | Partial (more reports, Excel/PDF pending) |
| M Notifications and jobs | BullMQ queue, worker, sweeper, retries, dead-letter (failed set) | — | eta-lifecycle | Partial (email/alerts pending) |
| N Audit and administration | Hash-chained audit, verification, tax versioning, settings | Audit, users | audit-reports | Done (retention pending) |

## Requirements matrix (brief → implementation)

| Brief requirement | Where | Status |
|---|---|---|
| Never present internal receipts as registered | receipt-view.ts, receipt-print.ts, eta-stamp.ts | Done |
| Separate internal and ETA status | receipt.model.ts `eta`, sales-transaction status | Done |
| No blind resubmission after timeout | eta-integration.service.ts | Done |
| Decimal arithmetic, server-side totals | money/decimal.ts, tax/calculation.ts | Done |
| Tax config versioning with snapshot | tax-configuration.model.ts, receipt lines `ruleCode/ruleVersion` | Done |
| No single hard-coded tax rate | tax rules are tenant data with verification source | Done |
| Tenant isolation in every query | services + tenant-guard.ts | Done |
| Secrets never in frontend/logs/responses | crypto.ts, logger redaction, select:false, tests | Done |
| OpenAPI contract | openapi.json generated from routes | Done |
| Arabic/English with RTL | i18n service, logical CSS | Done |
| Docker Compose, CI | docker-compose.yml, ci.yml | Written, not executed (KL-17) |

## Next steps (proposed order)

1. ETA preprod run with real test credentials; fix any contract differences; record evidence.
2. Signing integration once the signing device/specification is available.
3. Receipt correction workflow (`referenceOldUUID`).
4. SMTP mailer and alerting (rejections, failed jobs, 24-hour window, cash variance).
5. Customer and branch screens; MFA enrolment screen.
6. Import centre (uploads, validation, OCR as optional, review queue).
7. E2E tests in CI, restore test, container scan run.
