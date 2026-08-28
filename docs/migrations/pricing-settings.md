# Pricing settings rollout

## Purpose

This release adds global and per-service markup pricing while preserving integer-paise wallet accounting and historical order prices.

## Before enabling a non-zero markup

1. Confirm every `Service.rate` is the provider cost per 1,000 units. If a rate already contains a customer markup, correct that service first or it will be marked up twice.
2. Deploy the new schemas and create their indexes using the normal Mongoose deployment process.
3. Open the admin Pricing page. Its first read creates the singleton settings record with a 0% markup, so deployment alone does not change customer prices.
4. Preview representative provider rates, then save the intended global markup.
5. Apply `markupOverrideBps` only to services that need an exception. Use `null` to return a service to the global markup.

## Data behavior

- `PricingSettings.key=global` is the only settings record. Updates increment `version` and use optimistic concurrency.
- `AuditLog` records each successful settings update with its actor, request ID, before value, and after value.
- New orders store an immutable `pricingSnapshot` containing provider cost, selling price, applied markup, quantity, settings version, and timestamp.
- Existing orders are not backfilled or repriced. Their legacy `rate` remains unchanged.
- Customer catalogue and order-list APIs do not expose provider cost, effective markup, or gross spread.

## Rollback

Set the global markup and minimum margin to 0%. Existing snapshots remain unchanged. Do not delete pricing snapshots or audit records.
