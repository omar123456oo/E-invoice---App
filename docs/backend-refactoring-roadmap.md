# Backend refactoring roadmap

Ordered so that each step can be validated on its own with the existing test suite. Issue numbers refer to [backend-audit.md](backend-audit.md). The architecture stays a modular monolith; there is no rewrite.

Every step follows the same loop:
1. Run the tests (baseline).
2. Add a test for the defect or behaviour.
3. Make the smallest change.
4. Run the type check, tests and build.
5. Update [backend-refactoring-status.md](backend-refactoring-status.md).

## Phase 1: security and integrity quick wins (done 2026-10-19)

| Step | Issue | Result |
|---|---|---|
| Upgrade nodemailer to 10.1.7 behind an SMTP regression test | 1 | CI audit gate passes |
| Keep empty diffs in audit events | 2 | chain verifies after no-op updates |
| Single-recipient guard in `SmtpMailer` | 4 | list or CRLF recipients refused |
| Row-level error for a non-numeric price | 5 | import no longer crashes |

## Phase 2: toolchain (done 2026-10-19)

1. ✅ vitest 5.0.5 in both apps (issue 3).
2. ✅ uuid 11.1.1 override for exceljs.
3. ✅ ESLint, coverage floor and OpenAPI drift check in CI (issue 10). Linting also found and fixed issue 11.
4. Later: enable the `no-unsafe-*` rules module by module, alongside Phase 5. Add tests for `ServerlessQueue` and `runJob`, then raise the coverage floor.

## Phase 3: reliability (S)

1. Graceful shutdown with a deadline, fatal-error handlers, and a readiness check that pings MongoDB and Redis (issue 6). Test it by sending SIGTERM during a slow request.
2. Shared rate-limit store: Redis when configured, otherwise a MongoDB TTL collection (issue 8). The new collection needs **approval**.

## Phase 4: authorization by construction (S)

1. `route()` must declare `permission` or `selfService: true`, enforced by the types, plus a router-walking test (issue 7). No behaviour change.

## Phase 5: thin route handlers, one module at a time (M–L)

Order, from lowest to highest risk:
1. **branches** (pilot)
2. customers
3. pos-devices
4. users
5. products
6. tenants/company
7. receipts

For each module:
- Move queries and rules from `*.routes.ts` into `*.service.ts`, with the same inputs, outputs, errors and audit events.
- Add unit tests for the extracted rules. The existing API tests are the compatibility check.
- Introduce a repository only where a service needs a test seam.

Validate the pattern on the pilot before touching the rest.

## Phase 6: documentation

When their phases land, create `backend-architecture.md`, `backend-security-review.md` and `backend-testing-strategy.md`. Build them by updating the existing `architecture.md`, `security.md` and `testing-strategy.md` rather than duplicating them: the new files hold the refactoring-specific content and link to the existing ones.

## Needs approval before starting

- Changing any list endpoint's response shape.
- Adding the rate-limit collection.
- Anything that touches stored audit events.
