# Service availability monitoring

Automatically detects when a provider stops offering a service the panel sells, hides that service from customers, and alerts the admin — without an admin having to run a manual provider sync.

## What it checks

Every `SERVICE_AVAILABILITY_CHECK_MINUTES` (default 60), the worker re-fetches each enabled provider's service list — the same report-only call `POST /api/admin/providerSync/report` makes on demand — and compares it against known `ProviderOffer` records. See `services/serviceAvailabilityService.js`.

## Anomaly guard

A provider outage must never look like every service disappearing. Before applying anything, one check runs first:

- the provider returned **zero** services, or
- more than **30%** of its previously known offers are missing in this one check

Either condition raises one `PROVIDER_SYNC_ANOMALY` alert (`WARNING`) and changes nothing. The next scheduled check tries again from a clean state.

## Confirming a removal

A missing offer is tracked the same way manual sync already tracks it, via `ProviderOffer.consecutiveMissingSyncs`:

1. **First miss** — marked `SUSPECTED_UNAVAILABLE`. Applied silently: no alert, nothing hidden. The next scheduled check (about an hour later, by default) looks again.
2. **Second consecutive miss** — marked `UNAVAILABLE`, confirmed:
   - If another `ProviderOffer` for the same catalogue service is still `AVAILABLE` (a fallback provider, or another offer on the same provider), the catalogue service stays on sale. A `WARNING` alert (`SERVICE_OFFER_REMOVED`) tells the admin one of its offers is gone, so they can check whether it should stay the primary provider.
   - If no other offer covers it, the catalogue service is set `active: false` and stamped `autoHiddenAt`/`autoHiddenReason`. A `CRITICAL` alert (`SERVICE_REMOVED`) is raised. The service disappears from `/api/user/userServices` (not just blocked at order time) and can no longer be ordered.

Only offers already mapped to a catalogue service (`ProviderOffer.catalogueServiceId`) can trigger an alert or a hide. Unmapped provider offers still have their state updated so a later manual sync sees accurate history, but raise nothing — matching "alerts only for services you actually sell."

## Never touches price or spec changes automatically

A `changed` entry from the report is only auto-applied when its **only** relevant field is `availability` — i.e. the offer's cost, min/max, or description did not change, only whether it was seen. Any provider service with a cost, min/max, refill, or description change is left exactly as before for the existing manual review-and-apply flow (`docs/product-specs/providers.md`). This monitor never changes a price.

## Reappearance

If a provider lists a previously-`UNAVAILABLE` offer again, its state resets to `AVAILABLE` and any `SERVICE_OFFER_REMOVED`/`SERVICE_REMOVED` alert for it resolves automatically. If the linked catalogue service was auto-hidden, it is **not** automatically turned back on — an `INFO` alert (`SERVICE_REAPPEARED`) prompts the admin to review the offer and reactivate it deliberately.

## Reactivating a hidden service

`POST /api/admin/catalogueServices/:serviceId/reactivate` sets the service back to `active: true` and clears `autoHiddenAt`/`autoHiddenReason`. It only works on a service the monitor hid (`409 NOT_AUTO_HIDDEN` otherwise, so it never overrides a deliberate admin deactivation) and is audited. The Alerts page offers this as a one-click "Reactivate service" action on `SERVICE_REMOVED` and `SERVICE_REAPPEARED` alerts; the Provider Routing page shows an "Auto-hidden" badge with the same action on the affected catalogue row.

## Checking it manually

`POST /api/admin/serviceAvailability/check` runs the scan immediately instead of waiting for the schedule — used by the "Check service availability" button on the Alerts page. It has no provider side effects (report-only fetch) and is safe to run anytime.
