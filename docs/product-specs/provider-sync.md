# Provider synchronization: reviewed application

An authenticated admin starts a report with `POST /api/admin/providerSync/report` and a `providerId`. The API atomically saves a queued `ProviderSyncRun` and durable outbox record, then returns `202`. The background worker resolves that provider's own API URL and environment-backed credential, compares normalized values with stored `ProviderOffer` records, and saves proposed changes. Report generation never mutates offers.

Reports classify services as new, changed, missing, or invalid. A first missing observation proposes `SUSPECTED_UNAVAILABLE`; a subsequent consecutive completed report that is also missing the offer proposes `UNAVAILABLE`. Missing offers are never deleted.

An admin loads the stored report from `GET /api/admin/providerSync/runs/:runId`, reviews costs, ranges, refill support, missing status changes, and optional catalogue mappings, then explicitly applies it with `POST /api/admin/providerSync/runs/:runId/apply`. The browser may provide only provider-service-to-catalogue mappings. All offer values come from the stored server-generated report.

Application is one-time, idempotent, audited, and transactional with all offer writes. The server rejects incomplete reports, older reports when a newer completed report exists, and reports made stale by intervening offer changes. New services are inserted, changed services are updated, seen services reset their missing count and `lastSeenAt`, and missing services receive only the proposed availability/count transition. Invalid rows remain skipped and are counted in audit metadata.

Provider cost changes do not silently republish customer selling prices. Changes over 20% are highlighted in the admin review UI. Order pricing continues to use the authoritative published customer price and rejects a selected route if the provider cost would create a negative spread.

Provider synchronization is a read-only external operation and may retry up to three times with exponential backoff for server/transport failures. Configuration and validation failures are terminal. Sync retries never submit customer orders or switch providers. Customer fulfilment retains the one-attempt/ambiguous-outcome rules documented in `providers.md`.

Recent run metadata is available from `GET /api/admin/providerSync/runs`; full reports are omitted from this listing. Applying the schema in production requires the additive idempotency index described in `docs/migrations/provider-sync-application.md`.
