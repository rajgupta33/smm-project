# Legacy Service to catalogue mapping

This migration is additive and idempotent. It does not delete or repurpose legacy `Service` fields.

## Dry run

From `backend/`, run:

```powershell
npm run migrate:catalogue
```

Dry-run is the default. It validates every legacy record and prints counts without writing. Resolve all invalid records and mapping conflicts before applying.

## Apply

With `MONGO_URI`, `API_URL`, and `API_KEY` configured server-side, run:

```powershell
npm run migrate:catalogue -- --apply
```

Apply mode creates the `legacy-primary` provider if absent, creates one catalogue record per legacy customer-facing `serviceId`, creates one provider offer using legacy `service` as the internal provider ID, and links the legacy record through `catalogueServiceId`. Existing catalogue content and offer snapshots are not overwritten. A conflicting link is reported and skipped. Invalid or conflicting input produces a non-zero exit code, though valid records may already have been applied safely.

Before production use, take a database backup, run dry-run against the target data, retain its output, and test apply in staging. After apply, compare counts, inspect conflicts, verify random ID pairs, and rerun dry-run/apply to confirm idempotency. Rollback is performed by removing only records and links whose migration provenance source is `legacy_service_backfill_v1`; do not delete legacy `Service` records.
