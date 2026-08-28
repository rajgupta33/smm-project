# Durable refill requests

## Scope and trust boundary

New refill activity is stored in `RefillRequest`; the legacy `Order.refill` field is
only a compatibility mirror for accepted provider refill IDs. The browser supplies
an order ID and an idempotency key. It cannot choose a provider, provider order ID,
eligibility result, guarantee date, cooldown, or refill status.

The backend requires all of the following before creating a request:

- the database order belongs to the authenticated customer;
- the order has a confirmed provider submission and is `Completed` or `Partial`;
- the current provider offer supports refill and remains available;
- the catalogue refill policy permits refill when a normalized catalogue link exists;
- the configured guarantee has not expired;
- no active or support-blocked refill exists; and
- the previous request cooldown has elapsed.

For historical orders without normalized provider references, the stored legacy
refill availability is honored and the enabled legacy provider is resolved. Their
guarantee is derived from `createdAt` plus `REFILL_DEFAULT_GUARANTEE_DAYS`. This
fallback preserves access while normalized order snapshots accumulate.

## State and provider safety

The state machine is:

`REQUESTED -> VALIDATING -> SENT_TO_PROVIDER -> IN_PROGRESS -> COMPLETED`

Terminal alternatives are `REJECTED`, `FAILED`, and `EXPIRED`. An ambiguous provider
timeout, malformed acceptance, or worker interruption after the submission claim
moves the request to `NEEDS_SUPPORT`.

Provider refill submission has one allowed attempt. It is delivered through the
MongoDB outbox and `provider-refill` BullMQ queue with one BullMQ attempt. A unique
`activeOrderKey` prevents another refill while any request is active or ambiguous.
Neither the queue nor the customer can resubmit a `VALIDATING`/`NEEDS_SUPPORT`
request. The scheduled scan only retries safe provider status reads.

## APIs

Customer endpoints require authentication and CSRF:

- `POST /api/user/refills` with `Idempotency-Key` and `{ "orderId": "..." }`;
- `GET /api/user/refills`;
- `GET /api/user/refills/:refillRequestId`.

The legacy request/status paths remain as compatibility aliases, but new requests
use the durable service. Customer responses never expose provider IDs.

Admin endpoints require the database-backed admin role:

- `GET /api/admin/refills?status=...`;
- `POST /api/admin/refills/:refillRequestId/poll`.

Admin polling is a read-only provider status check. There is no force-complete or
automatic resubmit action.

## Deployment

Create and verify the `RefillRequest` unique indexes before enabling the UI. Run the
API and `npm run worker` against durable Redis and a MongoDB deployment supporting
transactions. Configure the default guarantee, cooldown, and poll interval in the
server environment. Validate accepted, rejected, timeout, interrupted-worker,
cooldown, duplicate-click, ownership, and legacy-order cases in staging.
