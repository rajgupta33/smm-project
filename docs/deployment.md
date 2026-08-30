# Production deployment: Vercel + Railway

Final architecture:

- `https://services.getfame360.com`: Vite frontend on Vercel.
- `https://api.services.getfame360.com`: always-running Express API on Railway.
- background worker: private Railway service using `npm run worker`.
- Redis: private Railway Redis shared by API and worker. Do not enable a public TCP proxy.
- database: MongoDB Atlas.
- payments: Cashfree.

Do not deploy, run production migrations, change DNS, or enable Cashfree production mode until the restored-snapshot rehearsal and staging checks are complete.

## Build and start settings

### Vercel frontend

- Root Directory: `frontend`
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: `dist`
- Variable: `VITE_API_BASE_URL=https://api.services.getfame360.com/api`
- Domain: `services.getfame360.com`

`frontend/vercel.json` supplies SPA fallback routing. The backend is not a Vercel project.

### Railway API

- Root Directory: `backend`
- Build Command: `npm ci`
- Start Command: `npm start`
- Healthcheck Path: `/health`
- Domain: `api.services.getfame360.com`

Railway supplies `PORT`; `server.js` binds it on `0.0.0.0`. Use `/health` for process health so a dependency outage does not cause a restart loop. Monitor `/ready` separately. It returns 200 only when MongoDB is connected, Redis is connected with `maxmemory-policy=noeviction`, and the worker heartbeat is fresh.

### Railway worker

- Root Directory: `backend`
- Build Command: `npm ci`
- Start Command: `npm run worker`
- Public domain: none

Start with exactly one always-on replica because it owns recurring schedulers. The heartbeat is written every 15 seconds and expires after 45 seconds. Alert on non-200 `/ready` and stale worker diagnostics.

### Railway Redis

- Keep Redis in the same Railway project as API and worker.
- Reference its private `REDIS_URL` from both services.
- Do not generate a public TCP proxy.
- Set and verify `maxmemory-policy=noeviction`; `/ready` fails otherwise.
- Keep `BULLMQ_PREFIX=smm-production` identical on API and worker.

Completed jobs retain at most 7 days/10,000 entries; failed jobs retain at most 30 days/10,000. MongoDB durable dispatch records and unique business indexes, not Redis, provide duplicate protection.

## Environment variables

Use Railway secret variables; never commit values. `backend/.env.production.example` is the names-only checklist.

### Shared by API and worker

| Variable | Production requirement |
|---|---|
| `NODE_ENV` | `production` |
| `MONGO_URI` | Atlas URI including database name; dedicated application user |
| `JWT_SECRET` | Random secret of at least 32 characters |
| `REDIS_URL` | Railway private Redis URL |
| `BULLMQ_PREFIX` | `smm-production`, identical on both services |
| `API_URL` | Provider API base URL, not this application's public API URL |
| `API_KEY` | Provider credential, server-side only |
| provider-specific credential variables | Every environment variable referenced by an enabled `Provider.credentialReference` record |
| `PROVIDER_TIMEOUT_MS` | Recommended `15000` |
| `MAX_MARKUP_BPS` | Approved business ceiling |
| `CASHFREE_APP_ID` | Production merchant App ID |
| `CASHFREE_SECRET_KEY` | Production secret, server-side only |
| `CASHFREE_ENV` | `production` only after sandbox sign-off |
| `CASHFREE_API_VERSION` | `2025-01-01`, the version pinned by this integration |
| `CASHFREE_RETURN_URL` | `https://services.getfame360.com/payments/return?order_id={order_id}` |
| `CASHFREE_NOTIFY_URL` | `https://api.services.getfame360.com/api/webhooks/cashfree` |
| `CASHFREE_DEFAULT_CUSTOMER_PHONE` | Approved 10-digit fallback required by the checkout flow |
| `CASHFREE_MIN_TOPUP_MINOR` | Approved minimum in paise |
| `CASHFREE_MAX_TOPUP_MINOR` | Approved maximum in paise |
| `CASHFREE_WEBHOOK_TOLERANCE_MS` | Recommended `300000` |
| `REFILL_DEFAULT_GUARANTEE_DAYS` | Approved default, e.g. `30` |
| `REFILL_COOLDOWN_HOURS` | Approved cooldown, e.g. `24` |
| `REFILL_STATUS_POLL_MINUTES` | Recommended `5` |
| `ORDER_STATUS_POLL_MINUTES` | Recommended `10` |

### API browser/security settings

| Variable | Value |
|---|---|
| `ALLOWED_ORIGINS` | `https://services.getfame360.com` exactly, no trailing slash |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAME_SITE` | `none` |
| `TRUST_PROXY` | `true` |

Do not set `COOKIE_DOMAIN` unless wider cross-subdomain sharing is intentionally required; host-only cookies reduce scope. Railway supplies `PORT`. `HOST` is optional and defaults to `0.0.0.0`.

The worker receives no browser traffic and does not operationally use cookie/CORS/proxy settings. The shared validator currently requires production `ALLOWED_ORIGINS`, so set the same value on the worker; cookie security and proxy settings may also be kept identical for configuration parity. All provider, Cashfree, MongoDB, Redis, pricing, timeout, refill, and polling values must match the API.

### Frontend

```text
VITE_API_BASE_URL=https://api.services.getfame360.com/api
```

All browser API calls use credentials. No Cashfree or provider secret belongs in a `VITE_` variable.

## MongoDB and migrations

Use Atlas with replica-set transactions, a dedicated least-privilege user, backups, and tested restore procedures. Configure network access for Railway egress.

Restore the latest backup to an isolated Atlas database and run from `backend/`:

```text
npm ci
npm run verify:migration -- --capture-baseline migration-baseline-pre.json
npm run migrate:production:dry-run
npm run migrate:production
npm run verify:migration -- --baseline migration-baseline-pre.json
```

The apply command stops at the first failure. Never run it automatically during deploy. See `docs/migrations/production-migration-runbook.md` for order, collections, counts, and recovery checks.

Create the first administrator separately after migration. Pipe the password through standard input using `npm run create:admin -- --userId <id> --password-stdin`; do not put it in shell history or a repository file. The older `--password` form remains compatible but exposes the value in process arguments and should not be used in production.

## Cashfree

The create-order request uses a deterministic merchant order ID and stable `x-idempotency-key`. The webhook captures exact bytes before JSON parsing and verifies its signature before settlement. The browser return page only polls server state and cannot credit a wallet. The worker reconciliation scan recovers missed webhooks.

Configure `https://api.services.getfame360.com/api/webhooks/cashfree` and subscribe to the required payment events. Confirm the signature secret/header scheme and API version in sandbox before switching credentials.

Duplicate credit is prevented by `Payment.creditedAt`, unique `cashfree-credit:<merchantOrderId>` wallet-ledger keys, webhook receipt uniqueness, a conditional payment update, and a MongoDB transaction.

## Order accounting and provider ambiguity

The current implementation follows option A: it transactionally debits the authoritative integer-paise wallet balance when the local order intent and durable dispatch are committed, before provider acceptance. The UI/event language calls this reserved, but the persisted funding state is `DEBITED`; it is not a separate spendable-balance reservation bucket.

A definitive provider rejection performs an explicit idempotent refund and marks the order `PROVIDER_REJECTED`/`REFUNDED`. A timeout, transport ambiguity, interrupted claimed attempt, or acceptance followed by local persistence uncertainty becomes `RECONCILIATION_REQUIRED`; it is neither refunded nor submitted to another provider until an administrator records evidence that proves acceptance or non-acceptance. The reconciliation path has immutable audit records and an idempotent compensation key. This is equivalent in safety intent to the preferred state machine without relabeling historical states.

## DNS and TLS

Add `services.getfame360.com` to Vercel and use the exact DNS record Vercel displays. Add `api.services.getfame360.com` to the Railway API and use Railway's displayed record. Do not create public records for Redis or the worker. Wait for both TLS certificates before enabling production cookies or callbacks.

## Verification

After deployment, from `backend/`:

```text
$env:API_ORIGIN='https://api.services.getfame360.com'
npm run verify:production
```

This calls only `/health` and `/ready`. Admins can inspect `/api/admin/operations/diagnostics` for queue counts, worker heartbeat, durable pending dispatches, and reconciliation-required orders.

Perform these manual staging checks separately with unique idempotency/request IDs and recorded evidence:

1. Login/logout: verify `Secure`, `HttpOnly`, CSRF, credentialed CORS, and rejection of an unapproved origin.
2. Cashfree sandbox top-up: verify one Payment, one ledger credit, one balance increase, and safe webhook replay.
3. Order submission: use a low-value approved service; verify server price, one debit, one durable dispatch, and no browser-controlled provider ID.
4. Provider submission: verify one provider order ID. Simulate timeout and verify `RECONCILIATION_REQUIRED` with no second submission.
5. Order status: verify polling and terminal behavior.
6. Wallet ledger: reconcile cached balance against ledger deltas and investigate every mismatch.
7. Refill, if supported: verify eligibility, cooldown, idempotency, provider result, and polling.

Production remains blocked until restored-snapshot migrations, wallet reconciliation, Cashfree sandbox tests, the provider ambiguity test, monitoring alerts, an Atlas restore exercise, and owner approval are complete.
