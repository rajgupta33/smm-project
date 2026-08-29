# Deployment: Vercel + Railway

Three deployable units across two platforms:

| Unit | Platform | Why there |
|---|---|---|
| Frontend (`frontend/`) | Vercel | Static Vite build, free tier, CDN |
| Backend API (`backend/`) | Vercel | Serverless Express via `api/index.js` |
| Worker (`backend/`, `npm run worker`) | Railway | Long-running process; serverless cannot host it |
| Redis | Railway | BullMQ queues |
| MongoDB | MongoDB Atlas | Replica set required for transactions |

The worker is not optional. `placeOrder` debits the wallet and writes a durable
outbox record, then the worker performs the actual provider submission. With no
worker running, customers are charged and orders are never submitted.

## Prerequisites

- MongoDB Atlas cluster (any tier; all Atlas clusters are replica sets)
- Railway project with a Redis service
- Cashfree merchant account (start in sandbox)
- Vercel account linked to the GitHub repository

## MongoDB Atlas

1. **Database Access** → create a dedicated application user, not a personal login.
2. **Network Access** → allow `0.0.0.0/0`. Vercel and Railway do not provide
   stable egress IPs on standard plans.
3. **Connect → Drivers** → copy the `mongodb+srv://` string and include a
   database name in the path before the query string.

Atlas M0 (free) has no automated backups. Before accepting real customer money,
move to a tier with backups — the wallet ledger is the only record of what each
customer is owed, and Cashfree cannot reconstruct balances (it knows deposits,
not spending).

## Railway: Redis

1. **New → Database → Add Redis**.
2. **Settings → Deploy** → append `--maxmemory-policy noeviction` to the existing
   start command. Do not remove the password flag. BullMQ loses jobs silently
   under an eviction policy.
3. **Settings → Networking → Generate Domain** to create the TCP proxy. The
   Vercel API needs a publicly reachable endpoint; Railway's private network is
   only reachable from inside the same project.

Two different URLs come out of this:

- **Private** (`redis.railway.internal`) — used by the worker, referenced as
  `${{Redis.REDIS_URL}}` so Railway wires it automatically.
- **Public** (proxy host/port) — used by the Vercel API. Build it as
  `redis://default:<password>@<public-host>:<public-port>`.

The public endpoint is protected only by its password. Treat it like a database
credential: environment variables only, never committed.

## Railway: worker service

1. **New → Deploy from GitHub repo** → select this repository.
2. **Settings**:
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm run worker`
   - Watch Paths: `backend/**`
3. **Variables**: every backend variable below, using the **private** Redis URL.
4. Deploy, then check logs for `SMM background worker is ready`.

## Vercel: backend API

Import the repository as a project with **Root Directory** `backend`. The
existing `backend/vercel.json` routes all paths to `api/index.js`.

Set every backend variable below, using the **public** Redis URL.

## Vercel: frontend

Import the repository a second time with **Root Directory** `frontend`.
Build command `npm run build`, output directory `dist`. The existing
`frontend/vercel.json` handles SPA routing.

Set `VITE_API_BASE_URL` to the deployed API origin plus `/api`. This is baked in
at build time, so changing it requires a redeploy.

## Backend environment variables

Identical on Vercel and Railway except `REDIS_URL`. A missing or invalid value
aborts startup — `getRuntimeConfig()` runs at module load and fails fast rather
than serving requests in a half-configured state.

| Variable | Value |
|---|---|
| `MONGO_URI` | Atlas connection string |
| `JWT_SECRET` | Random string, minimum 32 characters |
| `API_URL` | SMM provider API base URL |
| `API_KEY` | SMM provider API key |
| `REDIS_URL` | Private URL on Railway, public proxy URL on Vercel |
| `BULLMQ_PREFIX` | `smm` — must match across API and worker |
| `CASHFREE_APP_ID` | Cashfree App ID |
| `CASHFREE_SECRET_KEY` | Cashfree Secret Key |
| `CASHFREE_WEBHOOK_SECRET` | Same value as `CASHFREE_SECRET_KEY` |
| `CASHFREE_ENV` | `sandbox`, then `production` |
| `CASHFREE_API_VERSION` | `2026-01-01` |
| `CASHFREE_RETURN_URL` | `https://<frontend>/payments/return?order_id={order_id}` |
| `CASHFREE_NOTIFY_URL` | `https://<api>/api/webhooks/cashfree` |
| `CASHFREE_DEFAULT_CUSTOMER_PHONE` | 10 digits |
| `CASHFREE_MIN_TOPUP_MINOR` | `10000` (₹100) |
| `CASHFREE_MAX_TOPUP_MINOR` | `10000000` (₹100,000) |
| `CASHFREE_WEBHOOK_TOLERANCE_MS` | `300000` |
| `REFILL_DEFAULT_GUARANTEE_DAYS` | `30` |
| `REFILL_COOLDOWN_HOURS` | `24` |
| `REFILL_STATUS_POLL_MINUTES` | `5` |
| `ORDER_STATUS_POLL_MINUTES` | `10` |
| `MAX_MARKUP_BPS` | `100000` |
| `PROVIDER_TIMEOUT_MS` | `15000` |
| `ALLOWED_ORIGINS` | Frontend origin, exactly, no trailing slash |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAME_SITE` | `none` |
| `TRUST_PROXY` | `true` |
| `NODE_ENV` | `production` |

Frontend and API are separate Vercel projects on different origins, so cookies
must be `SameSite=None; Secure`. `ALLOWED_ORIGINS` must match the frontend
origin exactly or every browser request fails CORS.

Cashfree signs webhooks with the same Secret Key used for API calls. There is no
separate webhook secret to generate.

## Cashfree

1. Start in **Test Mode**.
2. **Developers → API Keys** → copy App ID and Secret Key.
3. **Developers → Webhooks** → add `https://<api>/api/webhooks/cashfree` and
   subscribe to payment success and failure events.

## First deploy

Run once against the target database, from a machine with `MONGO_URI` set:

```
cd backend
npm run migrate:catalogue
npm run migrate:job-dispatch
npm run migrate:drip-feed
npm run migrate:provider-sync-apply
npm run migrate:order-reconciliation
npm run migrate:wallet-minor
npm run create:admin
```

Run these against a restored snapshot first and verify balances and order
history reconcile. `migrate:wallet-minor` converts legacy floating-point
balances to integer paise; existing customer balances are wrong until it runs.

`create:admin` is the only way to obtain a first admin account. There is no
public registration route, and `createUser` requires an existing admin.

## Verification

| Check | Expectation |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `GET /ready` | `200` with `mongo: true, redis: true` |
| Worker logs | `SMM background worker is ready` |
| Login | Succeeds with the `create:admin` account |
| Top-up | Cashfree sandbox checkout credits the wallet |
| Order | Reaches the provider; status advances without manual refresh |

If `/ready` reports `redis: false` on Vercel, the TCP proxy is not exposed or
the public URL is wrong.

## Known behaviour on Vercel: webhook raw body

Cashfree webhook signatures are computed over exact request bytes. Some
serverless runtimes parse the request body before Express sees it, which leaves
`express.raw()` with an empty buffer and makes every signature check fail.

This degrades performance rather than losing money. The worker runs
`scan-pending-payments` every 60 seconds, polls Cashfree directly, and credits
the wallet through the same idempotent settlement path. Credits arrive within
about a minute instead of instantly.

Double-crediting is prevented three ways: an early return on `payment.creditedAt`,
a unique `WalletLedger` idempotency key of `cashfree-credit:<merchantOrderId>`,
and a conditional update guarded on `creditedAt: null`.

After deploying, check API logs for `Cashfree webhook raw body is empty`. If it
appears, webhooks are not verifying and reconciliation is carrying top-ups.
Fixing it means capturing raw bytes before the platform consumes them, or moving
the webhook endpoint onto the Railway service.

## Scaling notes

- The worker must run continuously. Its silent death is a money-losing outage:
  wallets are debited and orders never submitted. Alert on `/health` of the
  Railway service.
- Only one worker instance should run per environment. Job uniqueness is
  protected by database indexes, but concurrent schedulers duplicate scan work.
- Redis must keep `noeviction`. Evicted jobs are lost silently.
