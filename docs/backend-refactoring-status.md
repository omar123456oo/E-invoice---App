# Backend refactoring status

One entry per completed change. Issue numbers refer to [backend-audit.md](backend-audit.md); the plan is in [backend-refactoring-roadmap.md](backend-refactoring-roadmap.md).

**Baseline (2026-10-19, before any change):**
- 118/118 API tests pass.
- `tsc` is clean.
- Line coverage is 83.9%.
- `npm audit --omit=dev` reports 1 high and 2 moderate advisories, so the CI audit gate fails.

**Current (after Phase 2):**
- 122/122 API tests pass (22 files); 11/11 web tests pass.
- `npm run lint` (`tsc` + ESLint) is clean.
- API and web builds exit 0.
- Full `npm audit`: 0 vulnerabilities.
- Coverage (vitest 5 measurement): lines 80.0, statements 74.8, branches 65.2, functions 76.3.

## 2026-10-19: nodemailer 10.1.7 (issue 1)

- **Files:**
  - `apps/api/package.json` and `package-lock.json`: `nodemailer` 7.0.13 → 10.1.7, `@types/nodemailer` removed (v10 ships types).
  - `apps/api/test/smtp-mailer.test.ts` (new).
- **Why:** four high advisories (SMTP command injection), which made the CI audit gate fail.
- **Behaviour preserved:** `SmtpMailer` still calls `createTransport(url)` and `sendMail({from, to, subject, text})`. The new test checks the envelope, the From/To/Subject headers and that Arabic text survives. It passed on 7.0.13 before the upgrade and on 10.1.7 after it.
- **Tests run:**
  - `smtp-mailer` and `notifications` tests: 7/7.
  - Full suite: 121/121.
  - `tsc` clean, build exit 0.
  - Audit gate passes.
- **Outstanding risk:** the upgrade hasn't been tried against a real SMTP provider yet. Check one password-reset email in staging.

## 2026-10-19: audit events keep empty diffs (issue 2)

- **Files:** `apps/api/src/modules/audit/audit-event.model.ts` (`minimize: false`), `apps/api/test/audit-reports.test.ts`.
- **Why:** a no-op `PATCH /company` stored the event without `changes`, so chain verification failed.
- **Behaviour preserved:** the event shape, hash input and API are unchanged. Only empty objects are now persisted instead of being dropped.
- **Tests run:** the extended "hash-chained" test fails with the fix stashed (`expected false to be true`) and passes with it. The full suite passes.
- **Outstanding risk:** environments that already stored such events will keep reporting a break at that event. See the migration note in the audit. The local demo database was rebuilt.

## 2026-10-19: single-recipient guard for email (issue 4)

- **Files:** `apps/api/src/modules/notifications/smtp-mailer.ts`, `apps/api/test/smtp-mailer.test.ts`.
- **Why:** nodemailer parses `to` as a list, so a CRLF or comma in it added a recipient (shown by the test: `RCPT TO:<attacker@evil.test>`).
- **Behaviour preserved:** valid single addresses are delivered as before. The email outbox already records send errors and retries them, so a refused address shows up as a failed outbox item instead of mail to the wrong person.
- **Tests run:** the new test failed before the guard and passes after it. The notification tests (4/4) and the full suite pass.

## 2026-10-19: product price validation no longer throws (issue 5)

- **Files:** `apps/api/src/modules/products/product.schema.ts`, `apps/api/test/imports.test.ts`.
- **Why:** a non-numeric `unitPrice` threw inside a Zod refine and failed the whole import job.
- **Behaviour preserved:** valid and negative prices produce the same results and messages as before. A non-numeric price now gives a normal validation error, which becomes a row error in imports and a 422 on `POST /products`.
- **Tests run:** imports tests 5/5, full suite 121/121.

## 2026-10-19: vitest 5.0.5 in both apps (issue 3)

- **Files:**
  - `apps/api/package.json`: vitest and `@vitest/coverage-v8` 3.2.7 → 5.0.5.
  - `apps/web/package.json`: vitest 5.0.3 → 5.0.5.
  - Root `package.json`: `@vitest/coverage-v8` 5.0.5 is declared there so it installs next to the hoisted vitest. Without that, npm nested it under `apps/api` and `--coverage` failed with `Cannot find package '@vitest/coverage-v8'`.
  - `package-lock.json`.
- **Why:** critical advisories in tinypool and the vitest mocker.
- **Behaviour preserved:** test counts are unchanged (API 121, web 11), and `vitest.config.ts` needed no changes.
- **Rejected along the way:** `npm dedupe` would have swapped vite 7.3.7 for 8.3.4, removed rollup and moved dozens of unrelated packages. The lockfile was restored instead.
- **Outstanding:** coverage now reads lower purely because of the new measuring method (see audit issue 3).

## 2026-10-19: uuid override for exceljs

- **Files:** root `package.json` (`overrides.exceljs.uuid = "11.1.1"`) and `package-lock.json`.
- **Why:** moderate advisory GHSA-w5hq-g745-h8pq. npm's suggested fix was a downgrade of exceljs.
- **Behaviour preserved:** exceljs loads and its only use, `require('uuid').v4`, works. The XLSX import test passes.
- **Incident:** the first attempt, deleting the stale lock entry, left uuid uninstalled, so exceljs failed to load. Reinstalling `exceljs@4.4.0` re-resolved it. The lockfile diff was then checked against `HEAD`: every removed package belongs to vitest 3, nodemailer 7, `@types/nodemailer` or uuid 8.

## 2026-10-19: ESLint, coverage floor, OpenAPI drift check (issue 10)

- **Files:**
  - `apps/api/eslint.config.js` (new).
  - `apps/api/package.json`: `typecheck`, `lint` (= `tsc` + ESLint) and `test:coverage` scripts; eslint 10.13.0, typescript-eslint 8.71.2 and `@eslint/js` 10.0.1.
  - `apps/api/vitest.config.ts`: thresholds.
  - `.github/workflows/ci.yml`: coverage run and OpenAPI diff step.
  - `docs/openapi.json`: regenerated; it adds `/internal/cron/sweep`, and no other path or schema changed.
- **Lint clean-up (no behaviour change):**
  - Two initial values that were always overwritten: `eta-integration.service.ts` and `receipt.routes.ts`.
  - A literal BOM in a regex became `\uFEFF` (`csv.ts`).
  - The intentional `any` in `route.ts` is documented.
  - The fake SMTP server's comma expressions are rewritten as statements.
- **Tests run:**
  - `npm run lint` exit 0.
  - `test:coverage` exit 0 (122/122). The coverage gate exits 1 with an impossible threshold.
  - API build exit 0.
  - Web tests 11/11.

## 2026-10-19: in-process sweeper no longer crashes on a DB error (issue 11)

- **Files:** `apps/api/src/jobs/sweeper.ts` and `apps/api/test/sweeper.test.ts` (new).
- **Why:** an uncaught rejection from the tenant lookup ends the process on Node 22.
- **Behaviour preserved:** sweeps run in the same order with the same logging. A failed tenant lookup now logs `Could not list tenants to sweep` and that sweep ends. The next interval tries again.
- **Tests run:** the new test failed before the fix and passes after it. The sweeper, ETA lifecycle, notification and import tests pass (22/22), and so does the full suite.

## Not part of the refactoring

`apps/api/src/scripts/seed-activity.ts` (`npm run seed:activity`) is a development seed that drives every module through the API. Writing it is what surfaced issues 2 and 5. It refuses to run in production or with a non-simulated ETA transport.
