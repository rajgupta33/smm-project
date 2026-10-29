# Admin alerts

The panel raises alerts for problems it detects on its own. Alerts are shown only inside the admin panel: a count on the **Alerts** navigation link, a banner on the overview, and the `/adminAlerts` page.

## Lifecycle

- An alert is identified by a `dedupeKey`. While a condition persists, repeated detections update one alert (`occurrences`, `lastSeenAt`) instead of creating duplicates. MongoDB enforces this with a unique index on `dedupeKey` among unresolved alerts.
- `OPEN` → `ACKNOWLEDGED` (admin has seen it; removed from the navigation count) → `RESOLVED`.
- An acknowledged alert reopens only if its severity escalates, for example from `WARNING` to `CRITICAL`.
- Alerts resolve automatically when the next check finds the condition cleared. An admin may also resolve an alert manually; if the condition still exists, the next check opens a new alert.
- Admin acknowledgement and resolution are written to `AuditLog`.

## Provider balance alerts

The worker reads every enabled provider's balance using the SMM API `balance` action every `PROVIDER_BALANCE_CHECK_MINUTES` (default 30). Admins can also run a check from the Alerts or Providers page. Each provider stores its latest `balanceSnapshot`.

| Alert | Severity | Raised when | Clears when |
|---|---|---|---|
| `PROVIDER_LOW_BALANCE` | `WARNING` | Balance ≤ the provider's warning limit (default ₹2,000), or it covers 72 hours or less at the last 7 days' average provider cost | A check finds neither condition |
| `PROVIDER_LOW_BALANCE` | `CRITICAL` | Balance ≤ the critical limit (default ₹500), or it covers 24 hours or less | Same as above |
| `PROVIDER_INSUFFICIENT_FUNDS` | `CRITICAL` | A provider definitively rejects an order with wording such as "not enough funds" or "insufficient balance". The order is still refunded normally. | A balance check is no longer critical |
| `PROVIDER_BALANCE_CHECK_FAILED` | `WARNING` | Three consecutive balance reads fail | A balance read succeeds |

Limits are edited per provider on the Providers page, in rupees. Leaving a limit blank disables that fixed-amount check; the time-left check still applies. Balance alerts can be switched off per provider.

Balance reads have no provider side effects. They never retry or change orders.
