# Security and privacy

This document maps implemented controls to OWASP ASVS 4.0 areas. It is a
self-assessment, not an audit.

## Authentication (ASVS V2, V3)

- Passwords: scrypt from Node's standard library with the OWASP profile N=2^15, r=8, p=3 (≈32 MiB), 16-byte salt, constant-time compare; parameters are stored per hash and weaker hashes are upgraded at the next login. (argon2id was replaced because its native addon is not reliably bundled on serverless hosts.) Length 10–128, constant-time handling of unknown accounts.
- Lockout after 5 failures for 15 minutes; all attempts audited.
- Optional TOTP MFA (RFC 6238); secrets AES-256-GCM encrypted at rest.
- Access tokens: HS256 JWT, 15 minutes, issuer/audience checked, kept in browser memory only.
- Refresh tokens: 48 random bytes, stored as SHA-256, rotated on every use; reuse of an old token revokes the session. Cookie `rt`: httpOnly, Secure (production), SameSite=Strict, path `/api/v1/auth`; refresh also requires `X-Requested-With`.
- Every request re-checks session revocation and account status, so logout, deactivation, role change and password change take effect immediately.
- Password reset: single-use, 30-minute, hashed token; response does not reveal whether the email exists; all sessions revoked after reset.

## Access control (ASVS V4)

Server-side RBAC on every route (`permission` in the route definition) plus
branch restrictions for branch-bound roles and tenant scoping in every query.

| Role | Highlights |
|---|---|
| PLATFORM_ADMIN | Manages companies only; **no** access to company business data |
| COMPANY_OWNER | Everything in the company |
| COMPANY_ADMIN | Everything except company profile changes; cannot create owners |
| FINANCE_MANAGER | Read all; approve returns; requeue ETA failures; discount override; shift management |
| CASHIER | POS, own shifts, receipts, returns (request/complete), customers; assigned branches only |
| ACCOUNTANT | Read-only finance incl. customers |
| AUDITOR | Read-only, no consumer personal data |
| TECH_SUPPORT | ETA status, devices, health only |

The full matrix is `apps/api/src/common/security/permissions.ts`. Users cannot
change their own role/status, and can only assign roles below their own.

## Input handling (ASVS V5)

- Zod schema for every body, query and path parameter; unknown keys stripped.
- NoSQL injection: inputs are parsed into primitive types before reaching a query; free-text search is regex-escaped.
- CSV export neutralises formula injection.
- Card data: references that look like card numbers (Luhn) are refused; no PAN/CVV is ever stored.

## File uploads (ASVS V12)

- One file per request, size limit `MAX_UPLOAD_MB` (default 10 MB), in-memory parsing; permission is checked before the body is read.
- Type is decided by content (magic bytes via `file-type`); CSV must be valid UTF-8 without NUL bytes. Allowed types depend on the purpose.
- Malware scanning through ClamAV (`CLAMAV_ADDRESS`); infected files are refused and audited. Without a scanner, files are stored as `NOT_SCANNED` and the UI says so.
- Files are stored outside the web root under `STORAGE_DIR/<tenant>/<sha256>.<ext>` (mode 0600), keys validated against path traversal, downloaded only with `Content-Disposition: attachment` and `nosniff`; downloads are audited.
- Uploaded documents never create or submit tax receipts; extracted or reviewed values are untrusted and totals are recalculated on the server.

## Data protection (ASVS V6, V8)

- AES-256-GCM (`DATA_ENCRYPTION_KEY`) for ETA device credentials, MFA secrets, customer identity numbers and the stored ETA receipt documents (which may contain a buyer's national ID).
- Identity numbers are searchable only via HMAC; responses show the last 4 digits.
- Logs: structured pino with redaction of authorization headers, cookies, passwords, tokens, secrets, pre-shared keys and national IDs. The ETA client never logs bodies.
- Audit changes are redacted with the same rules; tests assert secrets never reach the audit trail.

## Transport and headers (ASVS V9, V14)

HTTPS terminated at the reverse proxy in production (HSTS from helmet), CSP
from helmet (`default-src 'self'`, `frame-ancestors 'none'`; inline allowed only
outside production for Swagger UI), CORS allow-list from `CORS_ORIGINS`, `trust proxy` set to 1 in
production, rate limits (600/min per IP on the API, 20 per 15 min on login and
password endpoints), `x-powered-by` disabled, Swagger UI disabled in production.

## Configuration safety

The process refuses to start when: secrets are short or missing, the encryption
key is not 32 bytes, the simulated ETA is selected in production, the ETA
production environment is selected outside production, or unsigned submissions
are configured against ETA production.

## Audit trail

Hash-chained per tenant; updates/deletes refused by the application; integrity
check at `GET /audit-events/verify`. Logged: logins (success/failure), sessions,
password and MFA changes, user/role changes, company/branch/device/credential
changes, product and tax changes (with before/after values), sales, returns,
approvals, reprints, ETA failures, report exports, audit views.

## Privacy (Egyptian PDPL — Law No. 151 of 2020)

Applicability and obligations (lawful basis, data-subject rights, registration
or licensing, cross-border transfer, breach notification) must be reviewed with
qualified counsel (compliance matrix U-09). Implemented minimisation measures:
anonymous consumer sales by default; identity collected only when the ETA rule
requires it; encryption; masked display; anonymisation endpoint for customer
profiles (issued receipts keep the legally required snapshot).

## Known gaps

See [known-limitations.md](known-limitations.md): no secret manager integration,
no automated dependency/container scanning results recorded yet (CI jobs defined),
JWT secret rotation is manual, malware scanning depends on an external ClamAV daemon.

## Incident response (summary)

1. Contain: revoke sessions (`POST /users/:id/revoke-sessions`), deactivate users or devices, rotate `JWT_ACCESS_SECRET` (signs everyone out).
2. Preserve: export logs and audit events; run `GET /audit-events/verify`.
3. Assess ETA impact: compare local receipts with ETA (receipt detail / reconcile).
4. Rotate affected ETA credentials with ETA and update them on the devices page.
5. Notify as required by law (counsel) and record the incident.
