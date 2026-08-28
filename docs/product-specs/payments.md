# Cashfree wallet top-ups

## Trust boundary

The browser may request an amount and open Cashfree hosted checkout. It cannot set a
payment status, select a gateway identity, or mutate a wallet. The backend converts
the validated amount to integer paise and records the authoritative `Payment`.

A wallet credit occurs only inside the MongoDB transaction used by the verified
success webhook or server-side reconciliation. The immutable wallet ledger key is
`cashfree-credit:<merchantOrderId>`. `Payment.merchantOrderId`, client idempotency,
gateway payment identity, webhook receipt identity, and the wallet ledger each have
database uniqueness appropriate to their role.

## API and lifecycle

- `POST /api/payments/cashfree/order` requires user authentication, CSRF, an
  `Idempotency-Key`, and `{ "amount": <rupees> }`.
- `GET /api/payments/orders` lists the current customer's safe payment history.
- `GET /api/payments/orders/:merchantOrderId` is ownership scoped and powers the
  return page. The return page only polls; it never credits.
- `POST /api/webhooks/cashfree` consumes the exact raw JSON bytes before Express's
  JSON parser. HMAC signature and timestamp are verified before parsing or acting.
- `GET /api/admin/payments` and `POST /api/admin/payments/:id/reconcile` require the
  database-backed admin role. Reconciliation cannot manually force success.

Create-order timeouts remain `PENDING` and are never blindly resubmitted. The
`payment-reconcile` BullMQ scheduler checks due `CREATED`, `PENDING`, and successful
payments against Cashfree. A matching `PAID` order plus `SUCCESS` payment can recover
a missed webhook. Successful refunds and open disputes are surfaced as `REFUNDED`
and `DISPUTED`; this phase does not silently debit a customer wallet or implement a
manual refund policy.

## Configuration and activation

All `CASHFREE_*` settings in `backend/env.example` are server-only. Production
return and notify URLs must use HTTPS. `CASHFREE_DEFAULT_CUSTOMER_PHONE` is a
temporary merchant-approved fallback because the legacy user schema has no phone;
replace it with verified per-customer contact data when that additive field ships.
Set `CASHFREE_WEBHOOK_SECRET` to the secret Cashfree uses for PG webhook HMAC
verification (normally the merchant PG secret key unless Cashfree has configured a
distinct webhook secret for the account).

The amount check is deliberately strict: the Cashfree order and successful payment
must both equal the local amount and use INR. Do not enable offers that change the
captured amount without first defining and testing the corresponding wallet-credit
policy.

Before production credentials are enabled:

1. create the Payment and webhook-receipt unique indexes;
2. deploy both the API process and `npm run worker` with durable Redis persistence;
3. configure Cashfree payment notifications to the HTTPS webhook URL and verify
   the merchant account can read refund/dispute state through the server APIs;
4. run sandbox create, success, failure, duplicate-delivery, invalid-signature, and
   missed-webhook reconciliation scenarios;
5. confirm one external success creates exactly one wallet ledger credit.
