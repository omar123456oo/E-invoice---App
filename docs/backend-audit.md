# Backend audit

Audit of `apps/api` on 2026-10-19, at commit `a047f08` plus the working-tree changes listed in [backend-refactoring-status.md](backend-refactoring-status.md).

## How the audit was done

Every finding below was checked against code or command output; nothing is inferred from file names alone.

| Check | How | Result |
|---|---|---|
| Test baseline | `npx vitest run` in `apps/api` | 118/118 passed (20 files) before changes; 121/121 (21 files) after |
| Coverage | `vitest run --coverage` (v8) | 83.9% lines, 74.0% branches, 79.4% functions |
| Type check | `npm run lint -w apps/api` (runs `tsc --noEmit`) | clean |
| Build | `npm run build -w apps/api` | exit 0 |
| Dependency audit | `npm audit --omit=dev` and full `npm audit` | see issue 1 and 3 |
| Import cycles | script over all runtime (non-`import type`) relative imports in `src/` | 0 cycles |
| Endpoint inventory | generated from the served OpenAPI document | 85 operations, 74 paths: [backend-api-inventory.md](backend-api-inventory.md) |
| Authorization coverage | script listing every `route({...})` without `permission` or `auth: false` | 12 routes, all self-scoped (issue 7) |
| Unbounded queries | grep of `Model.find(` without `limit` | none on large collections (see "Lower-priority observations") |

## Verified architecture

| Concern | Actual implementation |
|---|---|
| Runtime / framework | Node 22, Express 5.3, TypeScript 5.9 (ESM) |
| Database | MongoDB 7 replica set (transactions required), Mongoose 8.24 |
| Validation | Zod 4 on every params/query/body/header via the `route()` helper (`src/common/http/route.ts`); the same schemas generate OpenAPI |
| Authentication | HS256 JWT access tokens (issuer/audience pinned) + rotating refresh token in an httpOnly cookie, server-side sessions checked on every request, TOTP MFA, per-account lockout, scrypt password hashes |
| Authorization | Role → permission map (`src/common/security/permissions.ts`), checked in `route()`; branch scoping via `branchFilter`; tenant isolation enforced by a Mongoose plugin (`src/common/db/tenant-guard.ts`) that throws when a tenant-scoped query lacks `tenantId` |
| Errors | Central handler (`src/common/middleware/error-handler.ts`): one error envelope, no stack traces or DB internals in responses |
| Logging | pino + pino-http, request ids, redaction list for secrets |
| Jobs | BullMQ worker when `REDIS_URL` is set; otherwise in-process sweeper (dev) or `waitUntil` + Vercel Cron (serverless) |
| Files | multer memory storage with size/count limits, content sniffing, optional ClamAV, local or GridFS storage |
| Deployment | Docker / docker-compose, Vercel services (`vercel.json`), GitHub Actions CI |

Module layout is already a modular monolith: `src/modules/<module>/{*.routes.ts, *.service.ts, *.model.ts}` with shared code in `src/common`. The largest file is 385 lines (`eta-integration.service.ts`); nothing is oversized.

**Things that are already sound and should be preserved:** decimal-string money handling end to end, idempotent checkout and returns, the ETA state machine with reconciliation instead of blind resends, the hash-chained audit trail, environment validation that refuses unsafe production combinations (`src/config/env.ts`), and Zod-before-query as the NoSQL-injection defence.

## Ten highest-impact issues

Ranked by severity, then effort (S = under a day, M = days, L = a week or more).

| # | Issue | Severity | Effort | Status |
|---|---|---|---|---|
| 1 | nodemailer 7.0.13 has four **high** advisories (SMTP command injection) | High | S | **Fixed** |
| 2 | No-op updates silently break the audit hash chain | High | S | **Fixed** (see migration note) |
| 3 | Test toolchain has **critical** advisories (vitest 3.2.7 → tinypool, @vitest/mocker) | High (dev/CI only) | M | **Fixed** |
| 4 | Mail recipient string is parsed as an address list | Medium | S | **Fixed** |
| 5 | One non-numeric price crashes a whole product import | Medium | S | **Fixed** |
| 6 | Shutdown does not drain requests; no process-level error handlers; readiness ignores Redis | Medium | S | Open |
| 7 | `permission` is optional in `route()`, so a new route fails open to any signed-in user | Medium | S | Open |
| 8 | Rate limits are held in process memory | Medium | M | Open |
| 9 | Data access and business rules in route handlers of several modules | Medium | M–L | Open |
| 10 | Static checks are `tsc` only; no coverage gate; committed `openapi.json` is stale | Medium | S | **Fixed** |

### 1. nodemailer high-severity advisories: fixed

- **Evidence:** `npm audit --omit=dev` reported nodemailer as high: GHSA-p6gq-j5cr-w38f, GHSA-2x7j-588g-ccc2, GHSA-r7g4-qg5f-qqm2 and GHSA-v53p-9fqp-m79j (the last affects ≤10.0.5). CI runs `npm audit --omit=dev --audit-level=high`, so CI was failing on this.
- **Files:** `apps/api/package.json`, `src/modules/notifications/smtp-mailer.ts`.
- **Risk:** SMTP command injection through transport options. Our usage passes only a URL and a plain message, which limits exposure, but the gate was red.
- **Remediation (done):** upgraded to 10.1.7, the first version npm reports as fixing all of them. Removed `@types/nodemailer`, because v10 ships its own types. Added an SMTP regression test against a local fake server before upgrading.

### 2. No-op updates break the audit hash chain: fixed

- **Evidence:** `GET /audit-events/verify` returned `{"valid":false,"brokenAtSeq":52}` after `PATCH /company` was sent twice with the same values.
  - The diff was `{}`.
  - The event hash was computed over `"{}"`, but Mongoose's default `minimize: true` drops empty objects, so the stored event had no `changes`.
  - Re-computation then used `null`.
- **Files:** `src/modules/audit/audit-event.model.ts`, `src/modules/audit/audit.service.ts`.
- **Risk:** the tamper-evidence control reports tampering that did not happen. Any no-op update (company, product and others that record a diff) triggers it.
- **Remediation (done):** `minimize: false` on the audit schema. The test in `test/audit-reports.test.ts` was shown to fail without the fix and to pass with it.
- **Migration note:** events already stored this way cannot be repaired, because audit events are append-only by design. Any existing environment where verification already fails should be checked by inspecting the event at `brokenAtSeq`: missing `changes` on an update event means this bug, not tampering. The local demo database was rebuilt.

### 3. Critical advisories in the test toolchain: fixed

- **Evidence:** full `npm audit` reports tinypool as critical (prototype pollution leading to RCE in worker options, GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr) and vitest as critical/moderate (GHSA-82fw-gwwq-j7x9, path traversal via the mocker). Both come in through `vitest@3.2.7`.
- **Risk:** developer machines and CI runners only; not shipped in the production image. Exploitation needs attacker-controlled test configuration or a malicious dependency.
- **Remediation (done):** both apps are on vitest 5.0.5 with `@vitest/coverage-v8` 5.0.5. Test counts are unchanged (API 121, web 11). Full `npm audit` now reports 0 vulnerabilities.
- **Note:** vitest 4+ remaps v8 coverage differently, so the same code and tests measure lower (lines 83.9% → 79.7%, branches 74.0% → 64.9%). This is a change of measurement, not of tests.

### 4. Mail recipient parsed as an address list: fixed

- **Evidence:** the new test `test/smtp-mailer.test.ts` sent `to: "owner@example.test\r\nBcc: attacker@evil.test"`, and the fake server received `RCPT TO:<attacker@evil.test>`. nodemailer treats `to` as a list, so commas or CR/LF add recipients.
- **Reachability:** low today. Recipients come from user records whose email passed `z.email()` at creation. But the mailer must not rely on every caller validating.
- **Remediation (done):** `SmtpMailer.send` refuses anything that is not exactly one address. Subjects with CR/LF were already encoded safely, and a test now pins that.

### 5. One bad price crashes a product import: fixed

- **Evidence:** a CSV row with `unitPrice` = `abc` turned the whole import job into `FAILED: Invalid decimal string: abc` instead of flagging the row. In Zod 4, a `.refine()` still runs after `.regex()` fails, and the refine called `dec('abc')`, which throws.
- **Files:** `src/modules/products/product.schema.ts`. The same schema backs `POST /products`, `PATCH /products/{id}` and `POST /products/bulk`.
- **Remediation (done):** the refine skips values the regex already rejected. The existing import test gained a row with `abc` that must be reported as a row error. Other decimal schemas in the codebase use `.regex()` alone and are unaffected.

### 6. Shutdown and readiness: open

- **Evidence (`src/server.ts`):**
  - `server.close()` is not awaited, and `process.exit(0)` follows immediately. An in-flight checkout is aborted: the transaction rolls back, and the client can retry safely with the same `Idempotency-Key`, but it gets a connection reset.
  - No shutdown deadline is set.
  - No `unhandledRejection` or `uncaughtException` handler exists.
- **Evidence (`src/app.ts`):** `/health/ready` checks only `mongoose.connection.readyState` and never Redis, even when `REDIS_URL` is set.
- **Remediation:**
  - Await `server.close()` with a bounded deadline (for example 25 s, below the container stop timeout).
  - Log and exit on fatal process errors.
  - Make readiness ping MongoDB and Redis when configured.
  - The response shape stays `{status, mongo}`, adding `redis` only when configured.

### 7. Authorization fails open for new routes: open

- **Evidence:** `permission?: Permission` in `src/common/http/route.ts:27`, checked only `if (def.permission)`. Today the 12 routes without a permission are all correctly self-scoped: logout, me, sessions, password change, MFA, and the four notification routes, which filter by `ctx.userId`. A future route that forgets `permission` would be reachable by every role, including CASHIER.
- **Remediation:** make the choice explicit at the type level. Each route declares either `permission` or `selfService: true`, and the compiler rejects routes that declare neither. No runtime behaviour changes for existing routes. Add a test that walks the router stack and asserts every route made that choice.

### 8. Rate limits in process memory: open

- **Evidence:** `rateLimit({...})` in `src/app.ts` has no `store`, so express-rate-limit uses its per-process MemoryStore. On Vercel or with several containers, each instance counts separately, and counts reset on cold start.
- **Mitigation already present:** per-account lockout is stored in MongoDB (`failedLoginCount` and `lockedUntil` in `auth.service.ts`), so password guessing against one account stays limited.
- **Remediation:** use a shared store, Redis when `REDIS_URL` is set and otherwise a MongoDB TTL collection. Limits and response headers stay unchanged.

### 9. Logic in route handlers: open

- **Evidence:** direct `Model.find/update/create/...` calls per route file:

  | Route file | Calls |
  |---|---|
  | products | 9 |
  | tenants | 7 |
  | receipts | 7 |
  | pos-devices | 6 |
  | notifications | 6 |
  | imports | 6 |
  | customers | 6 |
  | users | 5 |
  | eta | 5 |
  | sales | 4 |
  | branches | 4 |

  For example, `PATCH /company` (`tenant.routes.ts`) holds the B2C-tag business rule, the update and the audit diff inline. Sales, returns, ETA, imports and reports already use services.
- **Risk:** rules are harder to unit-test and reuse (scripts and jobs duplicate queries), and a fix in one entry point can miss another.
- **Remediation:** move logic into `<module>.service.ts` one module at a time, keeping handlers to parse → call service → shape response. Start with the low-risk `branches` module as the pilot, then customers, pos-devices, users, products, tenants, receipts. Add repositories only where a service needs a test seam. API contracts don't change, and the existing API tests are the regression net.

### 10. Weak static checks and a stale spec: fixed

- **Evidence:**
  - `"lint": "tsc -p tsconfig.json --noEmit"`: there is no ESLint, so floating promises, unused code and misuse of `any` go unflagged.
  - Coverage is measured but not gated.
  - `docs/openapi.json` has 73 paths, while the served spec has 74 (it lacks the cron endpoint), and nothing in CI compares them.
- **Remediation (done):**
  - ESLint 10 with typescript-eslint, using `js` and `ts` recommended plus `no-floating-promises`, `no-misused-promises`, `await-thenable` and `no-unused-vars`. `npm run lint` now runs `tsc` and then ESLint.
  - CI runs `test:coverage` with a floor of lines 79, statements 74, branches 64 and functions 75. A deliberately impossible threshold was shown to fail the run.
  - CI regenerates `docs/openapi.json` and fails on any diff. The file was regenerated, and the only change is the cron path.
- **Not yet enabled:** the `no-unsafe-*` family (about 480 findings, mostly `any` from Mongoose lean results and test bodies). That is a separate, gradual step.

## Lower-priority observations

- **Moderate advisory via exceljs → uuid** (GHSA-w5hq-g745-h8pq): **fixed** with a scoped override (`overrides.exceljs.uuid = 11.1.1`). exceljs only calls `require('uuid').v4`, which uuid 11 still provides as CommonJS. The XLSX import test passes.
- **Unpaginated lists:** `GET /users`, `/branches`, `/pos-devices` and `/tax-configurations` return bare arrays. They are bounded by tenant size, so this is acceptable for now. Changing the response shape would break the Angular app, so any change must stay additive (opt-in `page` parameters).
- **Coverage gaps:**
  - BullMQ path: `jobs/bull.ts`, `worker.ts` and `handlers.ts` are at 0%.
  - ClamAV client: `scanner.ts` is at 18%.
  - Error-handler branches: 37.5%.
  - `smtp-mailer.ts` showed 0% in the baseline run, before its new test.
  `ServerlessQueue` and `runJob` (`jobs/serverless-queue.ts`, `jobs/handlers.ts`) are untested: `test/serverless.test.ts` covers only GridFS and the cron secret.
- **Reports** (`report.service.ts`) cap exports at `limit(50_000)` and load the rows into memory. That is acceptable at current volumes. Streaming CSV would be the next step if exports grow.
- **`trust proxy` is fixed at 1** in production. That is correct for one reverse proxy. On Vercel, confirm `req.ip` is the client address, because rate limits and audit IPs depend on it.

## Found during remediation

### 11. A database error in the in-process sweeper could crash the API: fixed

- **Evidence:** ESLint `no-floating-promises` at `src/jobs/sweeper.ts:110`. In `sweepAll()` every stage was wrapped in `try`/`catch` except the tenant lookup. A rejection travelled through `.finally()` as an unhandled rejection, which ends a Node 22 process.
- **Reach:** the in-process sweeper runs whenever `REDIS_URL` is unset. That includes development and any production deployment without Redis.
- **Remediation (done):** the tenant lookup is caught and logged like the other stages, and the timer callback also catches. `test/sweeper.test.ts` makes `TenantModel.find` throw and asserts there is no unhandled rejection. It failed before the fix and passes after it.

## What needs explicit approval before it is done

Nothing in the open items requires a destructive change. These would need sign-off:

- Any change to a list response shape (issue 9's lower-priority item).
- Moving rate-limit state into MongoDB (a new collection, which is non-destructive but is a schema addition).
- Any repair or annotation of historic audit events (issue 2).
