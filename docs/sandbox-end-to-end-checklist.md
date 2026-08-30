# Production-hosted sandbox end-to-end checklist

Use Cashfree sandbox credentials and an explicitly approved provider test service. Do not submit a paid provider order until the owner reaches the marked provider step and has confirmed that the provider account/service is safe for testing. Record request IDs, database IDs, timestamps, balances, and screenshots without recording secrets.

## Preconditions

- The audited commit is deployed to both Railway API and worker.
- `npm run verify:production` passes the public API.
- The restored-snapshot migration rehearsal and `verify:migration` pass.
- Production database migration has an approved backup, maintenance window, captured baseline, and owner authorization.
- Cashfree remains in sandbox and `CASHFREE_MIN_TOPUP_MINOR=1000`.
- API and worker use the same private `REDIS_URL` and `BULLMQ_PREFIX`; Redis reports `noeviction`.
- Worker heartbeat and queue-failure alerts are active.

## Checklist

1. **Admin login:** Log in with the first admin. Confirm the auth cookie is `Secure` and `HttpOnly`, CSRF is required for mutations, and `/api/admin/*` rejects a normal user.
2. **Markup:** Read the current pricing version. Set 25% as `globalMarkupBps=2500` with the expected version and a unique `X-Request-Id`. Confirm the audit record and version increment.
3. **Customer:** Create one named sandbox customer. Confirm no plaintext password is returned or logged.
4. **Assignment:** Assign one approved service and confirm provider IDs/costs are absent from the customer catalogue response.
5. **₹10 top-up:** Start a Cashfree sandbox checkout for `10.00` with a unique `Idempotency-Key`. Confirm the server creates a Payment for `amountMinor=1000` and sends Cashfree a stable `x-idempotency-key`.
6. **Settlement:** Complete sandbox payment. Confirm exactly one successful Payment and one wallet increase of 1,000 paise. Replay the same webhook and confirm no second increase.
7. **Ledger:** Confirm one `WalletLedger` credit with `type=PAYMENT`, matching before/after balances, and `cashfree-credit:<merchantOrderId>` idempotency key.
8. **Order preview:** For provider cost ₹100/1,000 and markup 2,500 bps, expect selling rate ₹125/1,000. Note the customer's balance before submission.
9. **Order submission:** Stop here unless the owner approves the provider test. Submit only the service ID, target, quantity, runs, and interval with a unique idempotency key. Do not send or trust a browser price/provider ID.
10. **Debit/reservation:** Confirm the server snapshot contains provider rate 10,000 paise, selling rate 12,500 paise, markup 2,500 bps, quantity, totals, pricing version, and timestamp. Confirm one ledger debit equals `sellingTotalMinor`.
11. **BullMQ/outbox:** Confirm one unique MongoDB `JobDispatch` and one BullMQ job. Repeating the HTTP request must not create another debit, dispatch, or provider attempt.
12. **Worker/provider:** With explicit approval, allow the worker to submit. Confirm one provider request. A simulated timeout must enter `RECONCILIATION_REQUIRED` and must not try a fallback provider.
13. **Provider identity:** Confirm `providerOrderId` is stored only after acceptance and is unique. It must not replace the local/public order ID.
14. **Status:** Confirm the scheduled status worker advances the order and stops polling after a terminal state.
15. **Refill:** For a provider-supported completed order inside its guarantee, request one refill with a unique key. Confirm ownership, cooldown, one provider request, persistent status polling, and no duplicate request on replay.

Afterward, run `npm run verify:migration -- --baseline migration-baseline-pre.json` again and review admin operations diagnostics for failed jobs, pending durable dispatches, stale heartbeat, and reconciliation-required orders.
