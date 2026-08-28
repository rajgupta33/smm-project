# Order submission state rollout

## Additive fields and indexes

The `Order` collection gains `localOrderId`, `providerOrderId`, lifecycle/funding status, immutable provider request fields, and one submission-attempt snapshot. Create these indexes in a controlled deployment:

- unique sparse `{ localOrderId: 1 }`;
- unique sparse `{ providerOrderId: 1 }`;
- `{ lifecycleStatus: 1, updatedAt: 1 }` for reconciliation review.

Existing `orderId` and its unique index are unchanged. Do not fabricate attempts or provider identifiers for historical orders.

## Compatibility

Existing documents default logically to `SUBMITTED` when read through the schema and continue treating `orderId` as the provider identifier. New documents use `orderId` as their stable public ID and store the provider identifier in `providerOrderId`.

## Reconciliation operations

Before deployment, establish an operational owner for orders in `RECONCILIATION_REQUIRED` or stale `SUBMITTING`. Review the stored attempt evidence and the provider portal using the target, service, quantity, and time window. Never resubmit merely because no provider order ID was returned.

Until a dedicated reconciliation command/UI exists, resolution is a controlled support/database operation with an audit record. Do not refund an ambiguous order until provider non-acceptance is proven.

## Rollback warning

Rolling application code back after creating new-format orders is unsafe because older code assumes `orderId` is the provider identifier. Pause order intake before rollback and keep the new adapter-aware status/refill code available.
