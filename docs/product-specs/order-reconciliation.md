# Order reconciliation

Provider submission timeouts, interrupted attempts, malformed responses, and acceptance-persistence failures remain paused as `RECONCILIATION_REQUIRED`. They are never automatically retried or sent to a fallback provider.

An authenticated current database administrator reviews the queue through `GET /api/admin/operations/reconciliationOrders`. For drip-feed orders, the API includes the exact unexecuted amount eligible for refund and the paused run number.

The admin must verify provider records and choose one definitive outcome through `POST /api/admin/operations/reconciliationOrders/:orderId/resolve`:

- `CONFIRMED_ACCEPTED` requires a verified provider order ID. A standard order moves to `SUBMITTED`. A paused drip-feed run is recorded as submitted; the parent completes or creates exactly the next durable scheduled run.
- `CONFIRMED_NOT_ACCEPTED` forbids a provider order ID. A standard order is rejected and fully refunded. A drip-feed parent is cancelled and only its unexecuted reserved value is refunded.

Legacy reconciliation records without an authoritative price snapshot may be confirmed accepted when provider evidence exists, but the UI disables rejection/refund. They require a separate engineering-led financial investigation; browser-era rate or total fields are never treated as authoritative refund values.

Every resolution requires a 10–2000 character evidence note and may include an HTTPS evidence URL. Evidence stays admin-only. The transition, immutable `OrderReconciliation` record, customer-safe order event, audit entry, wallet ledger refund, and any next drip-feed outbox record commit in one MongoDB transaction.

There is one reconciliation record per order and one unique request ID per administrator. Refunds also use the stable key `reconciliation-refund:<localOrderId>`. Replays cannot duplicate credits or create a second provider submission.

The resolution API deliberately has no retry/resubmit/fallback option. If evidence is not definitive, the order must remain in the queue.
