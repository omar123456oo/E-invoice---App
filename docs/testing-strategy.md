# Testing strategy

## Commands

```bash
npm test -w apps/api     # unit + integration (Vitest 3, in-memory MongoDB replica set)
npm test -w apps/web     # Angular unit tests (Vitest 5 + jsdom)
npm run lint -w apps/api # strict TypeScript check
```

Integration tests start one `mongodb-memory-server` replica set per run (the
first run downloads a MongoDB binary) and give every test file its own database.

## Results at the last run (2026-10-18)

| Suite | Files | Tests | Result |
|---|---|---|---|
| API | 20 | 118 | All passed |
| Web | 6 | 11 | All passed |
| Browser end-to-end (`npm run e2e`) | 1 | 9 steps | All passed |

The browser smoke test `e2e/smoke.mjs` (Chrome DevTools Protocol, also a CI job) covers: signed-out redirect to login, cashier sale with printed internal receipt, owner dashboard and receipt detail, customer creation, a CSV product import with an invalid row and partial import, the tax summary report, loading every administration page, a 390 px viewport without horizontal overflow, and no browser console errors. An earlier manual run also covered: Arabic login, open shift, product search, cart priced by the server,
cash sale with change, printed slip showing "internal receipt", owner dashboard,
receipts list and detail, company settings, device credentials, sending a receipt
to the simulated ETA (reached "Received — in review"), and a 390 px viewport
without horizontal overflow, with no browser console errors.

## Coverage by area

| Area | Tests |
|---|---|
| Money and rounding | `common/money/decimal.test.ts`, `tax/calculation.test.ts` (rounding, discounts, mixed tax, determinism, limits, unverified treatments refused, return proration) |
| ETA serialization | `eta/serializer.test.ts` — byte-for-byte match with the official ETA golden sample |
| ETA documents and UUID | `eta/receipt-document.test.ts` |
| ETA HTTP contract | `eta/eta-http-client.test.ts` (paths, headers, error classification) |
| State machine | `receipts/eta-status.test.ts` |
| Payments | `payments/payment-rules.test.ts` (tender, change, split, card-number refusal) |
| Configuration safety | `config/env.test.ts` |
| Auth and sessions | `test/auth.test.ts` (lockout, rotation and reuse detection, MFA, reset, deactivation) |
| Authorization and tenancy | `test/auth.test.ts` (RBAC, escalation, isolation, mass assignment, operator injection) |
| POS checkout | `test/checkout.test.ts` (server totals, chain, concurrency, idempotency, buyer threshold, discount limit, shift reconciliation, immutability) |
| ETA lifecycle | `test/eta-lifecycle.test.ts` (accept/validate, invalid, reject, timeout + reconcile, grace requeue, 401/422/429/5xx, bad structure + requeue, locking, credential backoff regression) |
| Returns | `test/returns.test.ts` (proportional amounts, exact full return, approvals, self-approval, refunds in reconciliation, ordering after original VALID, rejected originals) |
| Audit, reports, import | `test/audit-reports.test.ts`, `test/reports.test.ts` (tax summary net of returns, refunds, shifts, Excel export) |
| Corrections | `test/corrections.test.ts` (new UUID, same previousUUID, referenceOldUUID, header order, chain unaffected, 96 h window, permissions) |
| Notifications | `test/notifications.test.ts` (fan-out by permission, dedupe, email outbox retries, cash variance, 24 h window) |
| Import centre | `test/imports.test.ts`, `imports/csv.test.ts` (CSV/XLSX preview, row errors, partial commit, duplicates, content-type checks, malware block, document review totals) |
| Serverless / Vercel | `test/serverless.test.ts` (GridFS storage, cron secret), `auth/password.test.ts` (scrypt), `config/env.test.ts` (Vercel defaults) |
| Web | interceptor refresh/retry, cart store pricing and idempotency, ETA stamp, money helpers, message completeness |

## Simulated ETA

`SimulatedEtaApi` returns responses shaped like the documented ones and can
simulate accept, reject, timeout (processed or not), 401, 422, 429, 5xx and bad
structure. **Passing tests against it is not evidence of ETA acceptance.**
Official verification happens in the ETA preprod environment (eta-integration.md).

## Regression tests added for defects found during development

| Defect | Test |
|---|---|
| `toDecimal128` dropped trailing zeros ("50.00" stored as "50") | decimal.test.ts "keeps the scale…" |
| Fresh receipt JSON exposed the encrypted ETA document | checkout.test.ts first test (`etaDocumentEnc` undefined) |
| Credential backoff not cleared after saving new credentials | eta-lifecycle.test.ts "clears credential backoff…" |
| Global Mongo `sanitizeFilter` broke the server's own operators (password reset) | auth.test.ts password reset |
| Signed-out visitors saw a blank page (guard used `inject()` after `await`) | web guards.spec.ts, e2e step 1 |
| CSV import dropped leading zeros of barcodes | imports.test.ts (barcode `00123456`) |
| A correction without changes was accepted | corrections.test.ts |

## Deployment check

The compiled Vercel entry (`dist/vercel.js`) was loaded in production mode against an in-memory MongoDB: health, auth, cron and production security headers behaved as expected. Vercel's install and build commands from `vercel.json` were run on a clean copy of the repository and succeeded. A real Vercel deployment has not been run from this machine.

## Not yet automated

Load tests of concurrent
checkouts per device, ETA preprod integration runs, restore tests.
