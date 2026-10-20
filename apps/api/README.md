# API (backend)

This is the **backend** of the Egyptian B2C E-Receipt platform: an Express 5 +
TypeScript API over MongoDB (Mongoose), with a BullMQ worker for background
jobs. It is the only part of the system that talks to MongoDB, holds secrets,
or calls the Egyptian Tax Authority (ETA) — the Angular app in
[`apps/web`](../web) never does any of those.

## Responsibilities

- Every business rule (pricing, tax, returns, corrections, the ETA state
  machine) lives here, in `src/modules/*/*.service.ts` — never in the
  frontend, and never duplicated across endpoints.
- Every request is validated with Zod before it reaches a query (`src/common/http/route.ts`),
  which is also the project's NoSQL-injection defence: user input is parsed
  into primitives, so it can never carry a MongoDB operator.
- Authentication (JWT access token + rotating httpOnly refresh cookie + TOTP
  MFA), authorization (role → permission map, checked per route) and tenant
  isolation (a Mongoose plugin that refuses a tenant-scoped query without a
  `tenantId`) are all enforced here, independent of anything the Angular app
  does or doesn't check.
- Everything sensitive — ETA credentials, encrypted at rest; the audit trail;
  file scanning; email — lives here.

See [docs/architecture.md](../../docs/architecture.md) for the system diagram
and [docs/security.md](../../docs/security.md) for the full security model.

## Module layout

```
src/modules/<name>/
  <name>.routes.ts    Route definitions: HTTP method/path, Zod validation, the
                      permission required, and a thin handler that calls the
                      service and shapes the response (route + controller).
  <name>.service.ts   Business logic (present where a module has any beyond
                      simple CRUD — some smaller modules keep logic inline in
                      the route handler; see docs/backend-audit.md issue 9 for
                      which modules are mid-refactor toward splitting this out).
  <name>.model.ts     The Mongoose schema.
src/common/           Cross-cutting: http/route.ts, security/permissions.ts,
                      db/tenant-guard.ts, money/decimal.ts, errors, logging.
src/jobs/             BullMQ worker, the in-process sweeper (no Redis), the
                      serverless queue (Vercel), cron route.
src/scripts/          One-off/dev scripts: seeding, local MongoDB, OpenAPI export.
```

## Running it

```bash
npm run dev -w apps/api          # tsx watch, reads apps/api/.env if present
npm run dev:memory -w apps/api   # no setup: in-memory MongoDB + demo data + simulated ETA
```

## Configuration

Copy [`.env.example`](.env.example) to `.env` (git-ignored) and fill it in.
Required variables are validated at startup (`src/config/env.ts`) — the
process refuses to start with an invalid or unsafe combination (for example,
`ETA_TRANSPORT=simulated` in production, or production without `SMTP_URL`).

A persistent local MongoDB replica set (no Docker) is available via
`npm run db:start -w apps/api` — see the comment at the top of
`src/scripts/local-mongo.ts`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev -w apps/api` | Dev server with file watching |
| `npm run build -w apps/api` | Compile to `dist/` |
| `npm run lint -w apps/api` | Type check (`tsc`) + ESLint |
| `npm test -w apps/api` | Vitest (in-memory MongoDB replica set) |
| `npm run test:coverage -w apps/api` | Tests with coverage thresholds enforced |
| `npm run openapi -w apps/api` | Regenerate `docs/openapi.json` from the route definitions |
| `npm run seed:dev -w apps/api` | Demo company + users (refused in production) |
| `npm run seed:activity -w apps/api` | Drives every module through the running API (sales, returns, imports, ETA) — refused in production or with a non-simulated ETA transport |
| `npm run bootstrap -w apps/api` | Create indexes, and optionally a real first company (`BOOTSTRAP_*` env vars) |
| `npm run worker -w apps/api` | Background worker (needs `REDIS_URL`) |

## More documentation

- [Architecture](../../docs/architecture.md)
- [API reference](../../docs/api-reference.md) / generated [openapi.json](../../docs/openapi.json)
- [Security](../../docs/security.md)
- [Testing strategy](../../docs/testing-strategy.md)
- [Backend audit and refactoring status](../../docs/backend-audit.md)
