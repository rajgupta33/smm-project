# Provider submission contract

## Manual-priority selection

Each enabled `Provider` owns its API base URL, adapter type, timeout, and an `env:VARIABLE_NAME` credential reference. The secret value remains in the backend environment; it is not stored in MongoDB, returned by APIs, or written to audit logs.

For a mapped catalogue service, an admin selects a primary provider and an optional fallback. The backend chooses the primary available offer that covers the requested quantity. It may choose the configured fallback only when the primary is known to be unavailable before any external submission starts. Multiple offers without an explicit primary are rejected.

`COST_AWARE`, `QUALITY_AWARE`, and other automatic strategies remain disabled. Provider IDs and service IDs supplied by the browser are ignored.

## One-attempt rule

The provider adapter is created from the provider and offer selected during the authoritative order transaction. That provider mapping is immutable on the order and is used for submission, status, refill, drip-feed, and synchronization calls.

Before the provider call, the application atomically commits:

- the local order intent and immutable target/provider mapping;
- the authoritative price snapshot;
- the wallet debit;
- an idempotency key and stable public order ID.

The provider call happens only after that transaction commits. An atomic transition from `INTENT_COMMITTED` to `SUBMITTING` claims the sole automatic attempt. Replaying the HTTP request returns the existing order and does not claim another attempt.

## Outcome classification

- `ACCEPTED`: the response contains a non-empty provider order ID. The local order becomes `SUBMITTED`.
- `DEFINITIVE_REJECTION`: an explicit provider rejection is received. The order becomes `PROVIDER_REJECTED` and its debit is refunded atomically and idempotently.
- `AMBIGUOUS`: timeout, transport failure, provider 5xx, or a malformed response without an ID or explicit rejection. The order becomes `RECONCILIATION_REQUIRED`; funds remain debited because the provider may have accepted it.
- If acceptance is observed but cannot be persisted, the order also requires reconciliation.

No ambiguous outcome is automatically retried or sent to another provider.

A provider configuration failure discovered before the external call is a definitive local failure and can be refunded. Once the external call begins, transport uncertainty is always treated as ambiguous.

Provider response evidence is size-limited and secret-shaped fields are redacted before persistence. It is excluded from customer order responses.
