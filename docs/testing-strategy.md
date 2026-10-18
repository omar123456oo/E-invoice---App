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
| API | 13 | 97 | All passed |
| Web | 5 | 10 | All passed |

A browser smoke test (Chrome DevTools Protocol, run locally, not part of CI)
covered: Arabic login, open shift, product search, cart priced by the server,
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
| Audit, reports, import | `test/audit-reports.test.ts` |
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

## Not yet automated

End-to-end tests in CI (Playwright or similar), load tests of concurrent
checkouts per device, ETA preprod integration runs, restore tests.
