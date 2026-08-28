# Pricing

## Customer price

`Service.rate` is the provider cost in rupees per pricing unit. The default pricing unit is 1,000. The selling rate is:

```text
ceil(providerCostRateMinor × (10,000 + markupBps) / 10,000)
```

Order totals are:

```text
ceil(sellingRateMinor × quantity / pricingUnit)
```

All authoritative calculations use integer paise and round upward at each published monetary boundary.

## Markup selection

1. Use `Service.markupOverrideBps` when it is not null.
2. Otherwise use `PricingSettings.globalMarkupBps`.
3. Reject an effective markup below `minimumMarginBps` or above `MAX_MARKUP_BPS`.

The admin UI displays percentages, but the API and database use integer basis points (100 basis points = 1%). Settings updates require the current version and create an audit record.

## Customer boundaries

Customer catalogue responses contain only the derived selling rate. Provider cost, markup, internal provider identifiers, and gross spread are not returned. The order form may estimate from that server-derived rate, but order submission sends only the service ID, target, and quantity. The backend recalculates the charge.

## Historical pricing

Each new order stores an immutable price snapshot. A later settings or service-rate change affects only subsequent orders. Legacy orders without a snapshot continue using their stored legacy rate for display compatibility and are never backfilled automatically.
