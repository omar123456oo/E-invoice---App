# Egyptian B2C E-Receipt and Sales Platform

A multi-company point-of-sale and back-office platform for businesses selling to
consumers in Egypt. It issues e-receipts following the Egyptian Tax Authority
(ETA) receipt v1.2 specification and tracks each receipt's official status.

> **Status: development.** Not certified, approved or authorised by ETA. ETA
> submission has been tested only against a built-in **simulated ETA**. Issuer
> signing is not implemented. See [docs/implementation-status.md](docs/implementation-status.md)
> and [docs/compliance-matrix.md](docs/compliance-matrix.md) before any real use.

## What it does

- POS with barcode search, server-calculated totals, split tender, cash change, shifts and cash reconciliation.
- Receipts chained per POS device (`previousUUID`), UUID computed per the ETA serialization rules (verified against the official sample).
- ETA submission, status polling and reconciliation that never resends blindly after a timeout.
- Returns with approvals, proportional refunds and return receipts referencing the original.
- Corrections of rejected receipts per the ETA rules (`referenceOldUUID`, 96-hour window).
- Import centre: CSV/Excel product imports with row-level errors, document uploads with human review, malware scanning hook.
- In-app and email notifications for Tax Authority problems, the 24-hour submission window, cash variances and imports.
- Reports with CSV and Excel export.
- Versioned tax rules with recorded verification source; decimal-only arithmetic.
- Arabic (default, right-to-left) and English interface.
- Role-based access, tenant isolation, MFA, hash-chained audit trail, dashboard and CSV reports.

## Quick start (no Docker needed)

Requires Node.js 22.12+.

```bash
npm install
npm run dev:memory -w apps/api   # API on :3000 with in-memory MongoDB, demo data and SIMULATED ETA
npm start -w apps/web            # open http://localhost:4200
```

Demo users (password `ChangeMe-Dev-Only-123`): `owner@demo.local`,
`cashier@demo.local`, `finance@demo.local`, `platform@demo.local`. Demo tax rates
are placeholders, not verified rates.

For a persistent setup with MongoDB and Redis see [docs/deployment.md](docs/deployment.md). To deploy on Vercel see [docs/deployment-vercel.md](docs/deployment-vercel.md).

## Repository layout

```
apps/api   Express 5 + TypeScript API, BullMQ worker, tests (Vitest)
apps/web   Angular 22 application
docs/      Architecture, compliance, API (openapi.json) and operations docs
```

## Scripts

| Command | Purpose |
|---|---|
| `npm test -w apps/api` | API unit and integration tests (in-memory MongoDB) |
| `npm test -w apps/web` | Web unit tests |
| `npm run lint -w apps/api` | Strict type check |
| `npm run build` | Build API and web |
| `npm run openapi -w apps/api` | Regenerate docs/openapi.json |
| `npm run seed:dev -w apps/api` | Seed demo data into `MONGODB_URI` (refused in production) |
| `npm run worker -w apps/api` | Start the background worker (needs Redis) |
| `npm run e2e` | Browser smoke test against running API and web app (needs Chrome) |

## Documentation

- [Architecture](docs/architecture.md)
- [Database](docs/database-design.md)
- [API](docs/api-reference.md)
- [Workflows](docs/business-workflows.md)
- [Receipt lifecycle](docs/receipt-lifecycle.md)
- [ETA integration](docs/eta-integration.md)
- [Compliance matrix](docs/compliance-matrix.md)
- [Security](docs/security.md)
- [Deployment](docs/deployment.md)
- [Backup and recovery](docs/backup-and-recovery.md)
- [Testing](docs/testing-strategy.md)
- [User guide](docs/user-guide.md)
- [Known limitations](docs/known-limitations.md)
- [Implementation status](docs/implementation-status.md)
