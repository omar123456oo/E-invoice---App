# Implementation report: frontend/backend separation

2026-10-20. Scope: the request to separate the Angular frontend from the
Node.js backend. Full findings in [architecture-audit.md](architecture-audit.md);
the decision and plan in [refactoring-plan.md](refactoring-plan.md).

## Summary

The audit found the separation already in place at the level that matters —
independent packages, independent deploys, no shared code, MongoDB reachable
only from the backend, no secrets in the frontend, a documented REST contract
between them. The only gap was naming and documentation, not architecture.
Asked to choose between renaming `apps/api`/`apps/web` to `backend`/`frontend`
or documenting the existing names clearly, you chose the latter. That is what
was executed.

## Files changed

| File | Change | Why |
|---|---|---|
| `docs/architecture-audit.md` | new | Evidence for the headline finding, checked against the actual code (see the table of checks inside it) |
| `docs/refactoring-plan.md` | new | The options, the decision, the open items that remain (tracked separately, not duplicated) |
| `docs/implementation-report.md` | new (this file) | Final report, as requested |
| `apps/api/README.md` | new | The backend had no README. Describes its role, module layout, configuration, and scripts |
| `apps/web/README.md` | rewritten | Was untouched Angular-CLI boilerplate. Now describes its role as the frontend, exactly how it reaches the backend (`API_BASE`, proxy/rewrite, no cross-origin call ever), why there is no `.env`/`.env.example`, and its real scripts |
| `README.md` | edited | "Repository layout" now says explicitly which app is the backend and which is the frontend, and points to each app's README |
| `docs/architecture.md` | edited | "Monorepo" section now states explicitly that `apps/api`/`apps/web` are the backend/frontend and are independent, with a link to the audit |

No application code, route, schema, or stored document was touched. No
dependency was added or removed. No build, lint, or CI configuration changed.

## Why no code moved

Per the brief's own critical rules — don't rebuild from scratch, don't rename
without a verified technical necessity and migration plan, adapt to the
existing application instead of blindly moving files — and per your choice
once given the facts: renaming would have required coordinated edits to
`vercel.json`, `apps/api/Dockerfile`, `docker-compose.yml`,
`.github/workflows/ci.yml`, the e2e script, and every doc that names a path,
for a purely cosmetic outcome. The architecture-audit document preserves the
full list in case the decision is revisited later.

## Tests run and results

No code changed, so this was a verification of the existing baseline, not a
regression check against a prior run:

| Check | Command | Result |
|---|---|---|
| Backend tests + coverage | `npm run test:coverage -w apps/api` | 22 test files pass (122 tests); coverage 80.0% lines / 74.8% statements / 65.2% branches / 76.3% functions, all above the enforced thresholds |
| Frontend tests | `npm test -w apps/web` | 6 test files pass (11 tests) |
| Frontend leaks backend internals | `grep -rl "mongoose\|mongodb"` and secret-name greps over `apps/web/src` | none found |
| Doc links added in this change | existence check on every new relative link (`apps/api/README.md`, `apps/web/README.md`, and the docs they reference) | all resolve |

Carried over from the prior backend-only audit (2026-10-19, unchanged by this
session): `npm run lint -w apps/api` clean, both builds exit 0, `npm audit`
reports 0 vulnerabilities. Not re-run here since no dependency or source file
changed.

**Nothing in this change was BLOCKED.** Nothing required a live database,
external service, or credential, so there is nothing to flag as blocked.

## Unresolved items (not part of this change's scope)

Carried over from [backend-audit.md](backend-audit.md), unaffected by this
session, tracked in [backend-refactoring-roadmap.md](backend-refactoring-roadmap.md):

- Thin-controller extraction still open for `branches`, `customers`,
  `pos-devices`, `users`, `products`, `tenants`, `receipts` (Phase 5).
- Graceful shutdown and a combined MongoDB+Redis health check (Phase 3.1).
- Rate-limit counters are per-process memory, not shared across instances —
  fixing this needs a new collection and therefore your approval (Phase 3.2).
- `route()` lets a new endpoint omit its permission and default to "any
  signed-in user" (Phase 4).

None of these touches the frontend/backend boundary this session was asked
about.

## Next steps

- If you later do want the `backend/`/`frontend/` rename for convention
  reasons, [refactoring-plan.md](refactoring-plan.md) has the exact list of
  dependent paths and the stage-by-stage way to do it safely.
- Otherwise, the next planned work is Phase 3 of the existing backend roadmap
  (reliability: shutdown, health checks), which doesn't need your approval,
  followed by Phase 4 (authorization-by-construction).
