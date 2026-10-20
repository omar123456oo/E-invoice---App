# Architecture audit: frontend/backend separation

Audit performed 2026-10-20 at commit `5fd86ee`, clean working tree. This covers the request to "separate the Angular frontend from the Node.js backend." It builds on [backend-audit.md](backend-audit.md) (2026-10-19), which covered the backend in isolation; this audit looks at the boundary between the two apps and the full stack.

## Headline finding

**The separation this task asks for already exists**, as two independent npm-workspace packages with no shared code, no direct database access from the browser, and no secrets in the frontend. What differs from the literal folder layout in the brief is naming: the apps are called `apps/api` and `apps/web`, not `backend/` and `frontend/`. See [refactoring-plan.md](refactoring-plan.md) for what that means for Phase Two/Stage C, and the question I need an answer to before touching it.

## How this was checked

| Check | Method | Result |
|---|---|---|
| Frontend imports backend code or Mongo | `grep -rl "mongoose\|mongodb" apps/web/src` | none |
| Frontend holds a secret | `grep -rln` for `JWT_ACCESS_SECRET`, `DATA_ENCRYPTION_KEY`, `MONGODB_URI`, `CRON_SECRET` in `apps/web/src` | none |
| Workspace independence | `package.json` `workspaces: ["apps/api", "apps/web"]`; each app has its own `package.json`, lockfile entry, `tsconfig.json`, build and test scripts | independent |
| API base URL centralization | `apps/web/src/app/core/api/api.service.ts` | one `API_BASE = '/api/v1'` constant; every call goes through `ApiService` |
| Cross-origin exposure | `vercel.json` rewrites `/api/*` and `/health/*` to the `api` service and everything else to `web`, on the same domain; dev uses `proxy.conf.json` the same way | same-origin in both dev and prod; no public CORS surface to secure beyond `CORS_ORIGINS` |
| Auth transport | `apps/api/src/modules/auth/auth.routes.ts`, `apps/web/src/app/core/auth/auth.interceptor.ts` | JWT access token (15 min) in `Authorization`, httpOnly+Secure+SameSite=Strict refresh cookie, custom-header CSRF check, automatic refresh-and-retry on 401 |
| CORS allowlist | `app.ts`: `cors({ origin: cfg.CORS_ORIGINS, credentials: true, ... })` | explicit allowlist from env, not `*` |
| Rate limiting | `app.ts`: global 600/min on `/api/`, 20/15min on login and password routes | present |
| Security headers | `helmet(...)` with a CSP that drops `unsafe-inline` in production | present |
| Backend module shape | `ls apps/api/src/modules/*` | `<module>.routes.ts` (route + thin handler = route+controller), `<module>.service.ts` (business logic), `<module>.model.ts` (Mongoose schema), Zod schemas inline per route (validation), `permission:` referencing `common/security/permissions.ts` (permissions) |
| Baseline tests | `npm run test:coverage -w apps/api`, `npm test -w apps/web` | API 22 files / 122 tests pass; web 6 files / 11 tests pass |
| Baseline lint/build | carried over from [backend-refactoring-status.md](backend-refactoring-status.md) (2026-10-19) | `npm run lint -w apps/api` clean, both builds exit 0, `npm audit` 0 vulnerabilities |
| Docker | `apps/api/Dockerfile` (multi-stage, non-root user, healthcheck), `docker-compose.yml` (no secrets committed) | backend has its own image; frontend is a static Angular build served by Vercel or any static host, no image needed |
| `.env.example` | `apps/api/.env.example` exists | frontend has no `.env.example` because it has no environment file: `API_BASE` is a relative path, resolved by the proxy/rewrite, so there is nothing for Angular to configure differently per environment |

## What the brief asked for vs. what exists

| Brief's target structure | What exists | Gap |
|---|---|---|
| `frontend/` | `apps/web` (Angular 22, standalone components, signals, zoneless) | name only |
| `backend/` | `apps/api` (Express 5, TypeScript, Mongoose) | name only |
| `backend/src/modules/<name>/{routes,controller,service,model,validation,permissions}.js` | `backend/src/modules/<name>/{<name>.routes.ts (route+controller+validation via Zod), <name>.service.ts, <name>.model.ts}`, permissions centralized in `common/security/permissions.ts` | the brief's own text says not to split further than the existing architecture already provides; see recommendation below |
| MongoDB only reachable from backend | true today | none |
| Centralized API base in Angular | true today (`API_BASE`) | none |
| Typed interfaces/DTOs for API data | `apps/web/src/app/core/api/models.ts` and per-feature model files | none found missing on inspection; not exhaustively checked field-by-field |
| Interceptors | `authInterceptor` (functional, matches installed Angular 22) | none |
| `.env.example` for both apps | backend has one; frontend has none (nothing to put in it — see above) | not a gap, see note |
| `docs/architecture.md`, `docs/api-documentation.md`, `docs/deployment-guide.md` | `docs/architecture.md`, `docs/api-reference.md`, `docs/deployment.md` + `docs/deployment-vercel.md` already exist, current, and detailed | names differ slightly; content already satisfies the ask |

## Open items (not about separation, but found while auditing the full stack)

These are carried over or newly observed; none of them are blocking and none require renaming anything:

1. **Thin-controller work is still open for several backend modules** (`products`, `tenants`, `receipts`, `pos-devices`, `notifications`, `imports`, `customers`, `users` have 5–9 direct Model calls in their route files). Already tracked as issue 9 in [backend-audit.md](backend-audit.md) and phased in [backend-refactoring-roadmap.md](backend-refactoring-roadmap.md) Phase 5. Not re-litigated here.
2. **Graceful shutdown and combined health check** (issue 6) and **in-memory rate limiting on a serverless/multi-instance deployment** (issue 8) are still open from the same prior audit.
3. **No `apps/web/.env.example`** exists, but there is also no environment-specific value for the frontend to hold — `API_BASE` is a same-origin relative path by design. Documenting this explicitly (rather than adding a file with nothing real in it) is the honest version of "provide environment examples."

## Recommendation

Do not move or rename `apps/api`/`apps/web` to `backend`/`frontend`. The brief's own critical rules (`do not rebuild from scratch`, `do not rename ... without a verified technical necessity and migration plan`, `adapt this structure to the existing application instead of blindly moving files`) point the same way once the facts above are known: there is no technical necessity, because the separation of responsibilities the brief is actually after is already in place. A rename would touch `vercel.json` (both `root` paths), `apps/api/Dockerfile` (COPY paths), `docker-compose.yml`, `.github/workflows/ci.yml`, every doc under `docs/`, the e2e script, and local developer muscle memory (`npm run dev -w apps/api`) — all risk, no behavior change.

See [refactoring-plan.md](refactoring-plan.md) for the question this leaves open and the alternative, lower-risk way to get the same outcome (clarity for newcomers) without the rename.
