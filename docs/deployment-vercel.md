# Deploying on Vercel

The repository deploys as one Vercel project with two services (`vercel.json`):

| Service | Root | What runs |
|---|---|---|
| `web` | `apps/web` | Angular build served from Vercel's CDN; deep links fall back to `index.html` |
| `api` | `apps/api` | Express app as a Vercel Function (`dist/vercel.js`); receives `/api/*` and `/health/*` |

Both services run `npm ci` at the repository root (npm workspaces, one lockfile).

## How it differs from a server deployment

- **No worker process and no Redis.** Background jobs (sending receipts to ETA, imports) run right after the response inside the same function (`waitUntil`). Anything left over is picked up by the cron sweep and by **Tax Authority link → Run sending and follow-up now**.
- **Cron.** `vercel.json` schedules `GET /api/v1/internal/cron/sweep` daily at 03:00 UTC, the most the Hobby plan allows. On Pro, change the schedule to every 5–10 minutes (for example `*/10 * * * *`), because receipts must reach ETA within 24 hours.
- **Uploads are stored in MongoDB (GridFS)**, because the function filesystem is temporary. The upload limit defaults to 4 MB (Vercel's request body limit is 4.5 MB).
- **No ClamAV** on Vercel; uploads are marked "Not scanned" unless `CLAMAV_ADDRESS` points to a reachable scanner.

## 1. Create the database (MongoDB Atlas)

1. Create an Atlas cluster (any tier; Atlas clusters are replica sets, which the app needs for transactions).
2. Create a database user with read/write access to one database, e.g. `ereceipt`.
3. Network access: Vercel functions use changing IP addresses, so allow `0.0.0.0/0` (protected by the user's password) or use Vercel Secure Compute on Enterprise.
4. Copy the connection string and put the database name in it: `mongodb+srv://USER:PASS@cluster.xxxx.mongodb.net/ereceipt?retryWrites=true&w=majority`.

## 2. Prepare the database from your computer

Creates the indexes and the first company with its owner. `BOOTSTRAP_DEMO=true` also adds a demo branch, POS device, **placeholder** tax rules, three products and a cashier so you can try the POS (omit it for a real company).

```bash
MONGODB_URI="mongodb+srv://USER:PASS@cluster.xxxx.mongodb.net/ereceipt" \
BOOTSTRAP_LEGAL_NAME="My Company S.A.E." BOOTSTRAP_TRADE_NAME="My Store" \
BOOTSTRAP_RIN="123456789" BOOTSTRAP_ACTIVITY_CODE="4711" \
BOOTSTRAP_OWNER_EMAIL="you@example.com" BOOTSTRAP_OWNER_NAME="Your Name" \
BOOTSTRAP_DEMO=true \
npm run bootstrap -w apps/api
```

The owner's (and demo cashier's) password is printed once. The script is safe to run again.

## 3. Environment variables in Vercel

Project → Settings → Environment Variables (Production, and Preview if you use previews):

| Name | Value |
|---|---|
| `MONGODB_URI` | the Atlas connection string from step 1 |
| `JWT_ACCESS_SECRET` | output of `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `DATA_ENCRYPTION_KEY` | output of `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — **keep a copy; losing it makes encrypted data unreadable** |
| `CRON_SECRET` | another random value (Vercel Cron sends it automatically) |
| `SMTP_URL` | e.g. `smtps://USER:PASS@smtp.provider.com:465` — required in production for password reset and alerts |
| `MAIL_FROM` | e.g. `E-Receipts <no-reply@yourdomain.com>` |
| `ETA_TRANSPORT` | `http` |
| `ETA_ENVIRONMENT` | `preprod` (production only after ETA authorisation and signing — see compliance matrix) |
| `CORS_ORIGINS` | only if you use a custom domain: `https://your-domain.com` (defaults to the Vercel production URL) |

The API refuses to start with missing or unsafe settings (short secrets, simulated ETA in production, unsigned submissions to ETA production, no SMTP); the error is shown in the function logs.

## 4. Deploy

Push to the connected GitHub branch, or click **Refresh / Deploy** on the import screen. Then open the site and sign in with the owner account from step 2. Check `https://<your-site>/health/ready` returns `{"status":"ok","mongo":true}`.

## Notes and limits

- ETA submission uses the real ETA preprod API. Until the device has real ETA credentials (POS devices page), receipts stay queued with the error shown on the receipt; nothing is faked.
- Rate limits are per function instance (in memory). Add Vercel Firewall rate-limiting rules for stronger protection.
- Logs: Vercel → Project → Logs. Every API error response includes a `requestId` to search for.
