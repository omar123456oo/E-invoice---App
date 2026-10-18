# Deployment

> The Docker artefacts below were written but could **not be executed** on the
> development machine (Docker is not installed there). Treat them as unverified
> until run in your environment.

## Components

| Component | Image / command | Notes |
|---|---|---|
| API | `apps/api/Dockerfile`, `node dist/server.js` | Stateless; run ≥2 replicas behind a TLS-terminating proxy |
| Worker | same image, `node dist/jobs/worker.js` | Requires `REDIS_URL`; can run several replicas (device lease prevents double submission) |
| Web | `npm run build -w apps/web` → static files in `apps/web/dist/web/browser` | Serve from the same origin as `/api` (or set `CORS_ORIGINS`) |
| MongoDB | 7.x replica set (3 members in production) | Transactions required |
| Redis | 7.x with AOF persistence | Queue only; the database remains the source of truth |

## Local development

Without Docker (in-memory MongoDB, demo data, simulated ETA):

```bash
npm install
npm run dev:memory -w apps/api      # API on :3000 (data lost on exit)
npm start -w apps/web               # http://localhost:4200, proxies /api to :3000
```

With Docker:

```bash
cp apps/api/.env.example apps/api/.env   # set secrets
docker compose up -d mongo redis
npm run dev -w apps/api
npm run seed:dev -w apps/api
npm start -w apps/web
```

## Production configuration

Required environment: `NODE_ENV=production`, `MONGODB_URI` (replica set,
TLS, least-privilege user), `REDIS_URL`, `JWT_ACCESS_SECRET` (≥32 random bytes),
`DATA_ENCRYPTION_KEY` (32 bytes base64, from a secret manager), `CORS_ORIGINS`,
`ETA_TRANSPORT=http`, `ETA_ENVIRONMENT`, matching ETA base URLs,
`ETA_SIGNING_MODE=external` (production refuses `none`).

Checklist before go-live:

1. All compliance-matrix "needs preprod" rows verified with evidence.
2. Signing integration implemented and tested.
3. NTP time synchronisation on all hosts (ETA rejects future-dated receipts).
4. Indexes synced (`syncIndexes`) as a release step.
5. Backups configured and a restore test passed (see backup-and-recovery.md).
6. Real SMTP mailer configured (the in-memory mailer refuses production).
7. Rate limits and proxy `trust proxy` hop count reviewed.
8. Dependency audit and container scan clean (CI jobs).
9. Log shipping with retention; alerting on `level>=50` and on receipts in UNKNOWN/FAILED/REJECTED.

## CI

`.github/workflows/ci.yml`: type-check, tests and build for the API; build and
tests for the web app; `npm audit` (high); Trivy scan of the API image.
