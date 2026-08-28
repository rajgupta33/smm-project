# Order lifecycle

New orders use a stable `ord_…` public ID. The provider's identifier is stored separately and is not required to create the intent.

```text
INTENT_COMMITTED -> SUBMITTING -> SUBMITTED
                              -> PROVIDER_REJECTED + REFUNDED
                              -> RECONCILIATION_REQUIRED
```

The wallet debit, order intent, and durable `JobDispatch` outbox record commit in one MongoDB transaction. The HTTP request then returns `202 ORDER_QUEUED`; the dedicated worker submits to the provider. `submissionAttempt` records start/finish time, outcome, failure classification, HTTP status, and sanitized evidence.

Order submission jobs have one attempt. A timeout, transport failure, provider 5xx, malformed response, persistence failure after acceptance, or worker interruption after claiming the attempt becomes `RECONCILIATION_REQUIRED`. These states retain the debit and are never automatically submitted again or failed over to another provider.

Legacy orders without `localOrderId` remain readable. For provider status/refill operations they continue using their existing `orderId`; new orders use the private `providerOrderId`.

Customers cannot request provider status or refill while an order lacks confirmed provider acceptance. Customer APIs omit the provider service ID, provider order ID, target, raw response evidence, internal error text, and provider-cost pricing fields.

Admins can inspect unresolved orders at `GET /api/admin/operations/reconciliationOrders`. Resolution remains manual; this phase deliberately adds no unsafe resubmit action.
