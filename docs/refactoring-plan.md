# Refactoring plan: frontend/backend separation

Based on [architecture-audit.md](architecture-audit.md). Read that first; this is the plan, not the evidence.

## Decision (2026-10-20): keep `apps/api` / `apps/web`

You chose **option 1**: no renaming. `apps/api` and `apps/web` stay as they
are; the documentation now says explicitly which is the backend and which is
the frontend (`README.md`, `apps/api/README.md`, `apps/web/README.md`,
`docs/architecture.md`). That work is done — see
[implementation-report.md](implementation-report.md). The reasoning below is
kept for the record.

## The decision this plan is blocked on

The audit found that `apps/api` and `apps/web` already are the backend and frontend the brief describes: independent packages, independent builds and deploys, no shared code, MongoDB reachable only from `apps/api`, no secrets in `apps/web`, a documented REST contract between them. The only mismatch with the brief is the directory **names**.

Renaming `apps/api` → `backend/` and `apps/web` → `frontend/` is possible, but it is pure churn for a cosmetic goal: every reference to the old paths has to move together, or the app stops building/deploying:

- `package.json` → `workspaces`
- `vercel.json` → both services' `root`
- `apps/api/Dockerfile` → `COPY` paths (currently relative to repo root)
- `docker-compose.yml` → build context and volume paths
- `.github/workflows/ci.yml` → every `-w apps/api` / `-w apps/web` and the e2e step
- `e2e/smoke.mjs` and its npm script
- Every file in `docs/` that names `apps/api` or `apps/web` (there are many, including the ones just written)
- Any local `.env`, running dev servers, and IDE state pointing at the old paths
- Git history shows as a rename if done with `git mv`, but reviewers still see a mass diff

None of this adds a missing capability. It would not change what the frontend can reach, what the backend exposes, or how secrets are handled — those are already correct.

**I need you to choose before I touch any paths:**

1. **Keep `apps/api` / `apps/web`, do no renaming.** I update the few remaining docs to say explicitly "this is the backend" / "this is the frontend" next to the directory names, so a newcomer reading the repo sees the mapping immediately. Lowest risk, same outcome for anyone reading the docs.
2. **Rename to `backend/` / `frontend/` anyway** (e.g. because of an onboarding convention, a hiring rubric, or a tool that expects those names). I do it as a dedicated stage: `git mv`, then fix every path above one file at a time, re-run the full test/build/lint suite after each group of fixes, and only then move on. This is Stage C below, done in full.

I'll proceed with the rest of this plan either way, since none of it depends on the answer. If you don't tell me otherwise, I will default to option 1 once the rest of the plan is executed, because the brief's own rules ("do not rename without a verified technical necessity," "adapt ... instead of blindly moving files") argue for it, but it's your call to make, not mine.

## What does need work (independent of the naming decision)

These are genuine, verified gaps. None of them touches the frontend/backend boundary; they are regular hardening work, already scoped in [backend-audit.md](backend-audit.md) and [backend-refactoring-roadmap.md](backend-refactoring-roadmap.md):

| Item | Where | Plan |
|---|---|---|
| Thin-controller extraction for `branches`, `customers`, `pos-devices`, `users`, `products`, `tenants`, `receipts` | `apps/api/src/modules/*/*.routes.ts` | Phase 5 of the existing roadmap, one module at a time, pilot = `branches` |
| Graceful shutdown + combined health check (Mongo + Redis) | `apps/api/src/server.ts`, `app.ts` | Phase 3.1 of the existing roadmap |
| Rate limiting held in per-process memory | `apps/api/src/app.ts` | Phase 3.2 — needs approval, adds a collection |
| `route()` permission is optional, so a new route can fail open | `apps/api/src/common/http/route.ts` | Phase 4 of the existing roadmap |
| No `apps/web/.env.example` | n/a | Document in `apps/web/README.md` why none is needed (no environment-specific value exists; `API_BASE` is a same-origin relative path) instead of adding an empty file |

## Stages, as requested

**Stage A — Audit.** Done: [architecture-audit.md](architecture-audit.md), this plan.

**Stage B — Propose exact changes.** Covered above: either (1) a documentation-only clarification, or (2) a full rename with every dependent path fixed. Awaiting your choice.

**Stage C — Separate frontend/backend.** Already done at the package level (prior work). If you choose option 2, this stage becomes the rename, executed as: `git mv apps/api backend && git mv apps/web frontend`, then fix paths in the order listed in "Renaming... is possible" above, verifying tests/build after each.

**Stage D — Repair imports, scripts, configuration, API URLs.** Only applies under option 2; same list.

**Stage E — Refactor backend responsibilities / frontend API communication.** Already substantially done (see audit). Remaining work is the thin-controller table above, tracked separately so it isn't re-done here.

**Stage F — Security improvements.** Already substantially done (JWT, httpOnly+Secure+SameSite cookie, CSRF header, rate limiting, CORS allowlist, Helmet CSP, RBAC, tenant isolation, audit trail, scrypt password hashing — see audit table). Remaining items are the roadmap's Phase 3/4 above.

**Stage G — Run builds, tests, regression checks.** Baseline captured in the audit (API 122/122, web 11/11, lint clean, 0 `npm audit` findings). Re-run after any change in this plan, same as every change in the existing roadmap already does.

**Stage H — Update documentation.** `docs/architecture.md`, `docs/api-reference.md`, `docs/deployment.md`/`deployment-vercel.md` already satisfy the brief's `architecture.md`/`api-documentation.md`/`deployment-guide.md` asks and are current (verified by reading them during the audit). If option 1 is chosen, I add a short "this is the backend/frontend" callout to each rather than renaming files that already serve the purpose.

## Acceptance criteria

- No feature, route, field, or stored document changes as a result of this plan.
- `apps/web/src` has zero references to MongoDB, Mongoose, or any backend-only secret (already true; re-verified after any change).
- Every API call from Angular continues to go through `ApiService` / `API_BASE` (already true).
- Baseline test/build/lint counts do not regress (122/122 API, 11/11 web, lint clean).
- If option 2 is chosen: `npm run build` (root), `npm test` (root), the Vercel dry-run equivalent (`npm run vercel-build -w apps/api`, `npm run build -w apps/web`), and `npm run e2e` all still pass with the new paths, and `git log --follow` on a moved file still shows its history.
