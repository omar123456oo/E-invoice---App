# Web app (frontend)

This is the **frontend** of the Egyptian B2C E-Receipt platform: an Angular 22
application (standalone components, signals, zoneless change detection,
Angular Material). It renders the POS, back office and reports, and holds no
business logic that the backend doesn't also enforce — route guards here are
for user experience, not security (see [backend's README](../api/README.md)
and [docs/security.md](../../docs/security.md) for where enforcement lives).

The backend is [`apps/api`](../api).

## How it talks to the backend

Every API call goes through `ApiService` (`src/app/core/api/api.service.ts`),
which prefixes paths with the single constant `API_BASE = '/api/v1'`. There is
no other place in the app that builds a backend URL.

`API_BASE` is a **relative path**, not a hostname, by design: in every
environment this app is served from the same origin as the API —

- **Local development:** `proxy.conf.json` forwards `/api/*` from
  `localhost:4200` to the API at `localhost:3000`, so the browser never makes a
  cross-origin request and the backend's `CORS_ORIGINS` allowlist exists only
  as defence in depth, not as the thing making dev work.
- **Production (Vercel):** the repository's `vercel.json` rewrites `/api/*`
  and `/health/*` to the API service and everything else to this app, on the
  same domain.

**There is no `.env` or `environment.ts` for this app, and intentionally no
`.env.example`.** There is nothing environment-specific to configure: the API
base is always the same relative path, and every secret (JWT signing key,
database credentials, ETA credentials, encryption key) lives only in the
backend's environment, never here. If a future deployment target needs a
cross-origin API (a different domain for the API), that is the point at which
`API_BASE` would need to become configurable — it currently is not, because it
has never needed to be.

Authentication: the backend issues a short-lived JWT access token (kept in
memory by `AuthService`, not in storage) and a long-lived refresh token in an
httpOnly cookie the browser cannot read. `auth.interceptor.ts` attaches the
access token to every `/api/v1` request and, on a 401, calls
`POST /auth/refresh` once and retries.

## Development server

```bash
npm start -w apps/web          # ng serve --proxy-config proxy.conf.json, http://localhost:4200
```

The API must be running first (see the backend README) — otherwise requests
through the proxy fail.

## Building

```bash
npm run build -w apps/web      # dist/web/browser
```

## Tests

```bash
npm test -w apps/web           # Vitest + jsdom
```

## Project layout

```
src/app/core/        API client, auth (token, interceptor, guards), notifications
src/app/features/    One folder per screen (pos, receipts, returns, reports, ...)
src/app/shared/       Reusable components
```

Route guards (`core/auth/guards.ts`) redirect signed-out or under-permissioned
users for a clean UX; every one of those permissions is re-checked by the
backend on the actual request, so a guard bug here is a UX bug, not a security
hole.

## More documentation

- [Architecture](../../docs/architecture.md)
- [API reference](../../docs/api-reference.md)
- [User guide](../../docs/user-guide.md)
