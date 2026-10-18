# Architecture

## System context

```
 Browser (Angular 22)  ──HTTPS──▶  API (Express 5, Node 22)  ──▶  MongoDB (replica set)
   back office + POS                │   REST /api/v1                 source of truth
                                    │
                                    ├──▶ Redis + BullMQ  ◀── Worker process (ETA jobs, sweeper)
                                    │                         │
                                    └──── ETA adapter ◀───────┘──HTTPS──▶ ETA identity + eReceipt API
```

- **API** serves the Angular app's REST calls, validates every request with Zod,
  enforces authentication, RBAC and tenant isolation, and writes MongoDB.
- **Worker** (`dist/jobs/worker.js`) runs ETA submission, polling and
  reconciliation jobs and import processing from BullMQ, plus a 30-second database sweeper
  that also sends the email outbox and raises 24-hour-window alerts.
  Without Redis (development) the API runs the sweeper in-process.
- **MongoDB** is the source of truth for every receipt's ETA state. Queues only
  speed work up; a lost job delays work until the next sweep and never loses a receipt.

## Monorepo

```
apps/api      Express + TypeScript API, worker, scripts, tests
apps/web      Angular 22 application (standalone components, signals, zoneless)
docs/         Documentation and generated openapi.json
```

## Backend modules (`apps/api/src/modules`)

| Module | Responsibility |
|---|---|
| auth | Login, TOTP MFA, sessions, refresh-token rotation, password reset |
| users | User administration, role assignment rules |
| tenants | Companies (platform admin) and company settings |
| branches | Branches with ETA branch code and address |
| pos | POS devices (ETA serial, credentials, receipt chain), cashier shifts |
| products | Catalogue, official item codes, bulk import validation |
| customers | Optional buyer profiles with encrypted identity numbers |
| tax | Versioned tax rules and the calculation engine |
| sales | Quote and checkout |
| receipts | Issuance (UUID chain), ETA state machine, receipt views |
| payments | Payment/refund records and tender rules |
| returns | Return requests, approvals, return receipts, refunds |
| eta | Serializer, receipt document builder, HTTP client, token manager, signer, submission/reconciliation service, simulated ETA |
| reports | Dashboard and operational reports, CSV export |
| audit | Hash-chained audit trail |
| notifications | In-app notifications fanned out by permission, durable email outbox, SMTP mailer |
| imports | Upload validation, malware scanning, private storage, product imports, document review |

Shared code lives in `src/common` (errors, logging, middleware, security, money,
db helpers, route helper). Each route is declared once with `route()`; `mount()`
registers it in Express **and** in the OpenAPI document, so the contract cannot
drift from the implementation.

### Request pipeline

`requestId → pino-http → helmet → CORS (allow-list) → JSON (1 MB) → cookies →
rate limit → [authenticate → permission check] → Zod parse (unknown keys stripped)
→ handler → service → MongoDB` with a central error handler producing
`{ error: { code, message, requestId, details[] } }`.

### Key design decisions

1. **Decimal money only.** decimal.js in code, Decimal128 in MongoDB, decimal
   strings in JSON. JavaScript numbers are refused for fractional amounts.
2. **Server-side calculation.** The browser never sends prices or totals; the
   POS shows server quotes, and checkout recalculates.
3. **Literal-preserving ETA documents.** Numbers are modelled as literals so the
   JSON we send and the text we hash are produced from the same tree.
4. **Per-device chain with compare-and-swap inside a transaction.** Concurrent
   checkouts on one device cannot fork the `previousUUID` chain.
5. **Separate statuses.** Transaction status, return status and ETA status are
   separate fields; only ETA status `VALID` means officially registered.
6. **Never resend blindly.** Timeouts, 5xx and duplicate-submission responses
   move receipts to `UNKNOWN`; reconciliation asks ETA by the locally known UUID.
7. **Defence-in-depth tenancy.** Services scope by `tenantId`; a Mongoose plugin
   throws on any tenant-scoped query without a tenant filter.

## Frontend (`apps/web/src/app`)

```
core/      api client + DTOs, auth (service, interceptor, guards), i18n, layout shell, notifications
shared/    ETA stamp, receipt print slip, money/date pipes, paginator, dialogs
features/  login, dashboard, pos, receipts, returns, products, settings, eta, administration
```

- Lazy-loaded routes guarded by permission (UI only; the API enforces everything).
- Access token in memory; refresh token in an httpOnly, SameSite=Strict cookie
  scoped to `/api/v1/auth`; refresh requires `X-Requested-With`.
- Arabic is the default language; switching sets `dir` on `<html>`, so layouts
  mirror through logical CSS properties.
- Money is formatted with `Intl.NumberFormat` (`ar-EG`/`en-EG`, EGP); dates in `Africa/Cairo`.
