# Order reconciliation collection rollout

This phase adds the immutable `orderreconciliations` collection with unique indexes on `orderId` and `{ resolvedBy, requestId }`. It also extends existing order and drip-feed attempt enums with `RECONCILED_NOT_ACCEPTED`; no historical document is rewritten.

Before enabling operator resolution in production:

1. Back up orders, drip-feed orders/runs, wallet ledgers, and order events.
2. From `backend/`, run `npm run migrate:order-reconciliation` against the intended `MONGO_URI`.
3. Verify the collection and unique indexes.
4. Deploy the API and frontend.
5. Resolve controlled staging examples for accepted, not-accepted, and paused drip-feed outcomes.
6. Confirm wallet credits, order events, audit entries, and next-run outbox records are atomic.

The migration creates a collection and indexes only. It does not resolve, refund, retry, or modify any historical order.
