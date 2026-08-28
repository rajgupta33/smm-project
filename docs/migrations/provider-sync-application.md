# Provider sync application index rollout

This phase adds application metadata to `ProviderSyncRun` and one additive unique partial index on `{ appliedBy, applyRequestId }`. Existing reports remain valid: absent `applicationStatus` values are treated as pending and are populated only if an admin applies that report.

Before enabling report application in production:

1. Back up the `providersyncruns` and `provideroffers` collections.
2. Deploy the API code while keeping provider application unavailable to operators.
3. From `backend/`, run `npm run migrate:provider-sync-apply` once against the intended `MONGO_URI`.
4. Verify the new partial unique index and confirm existing report counts are unchanged.
5. Deploy/restart the frontend, API, and worker, then apply a newly generated staging report first.

The migration creates indexes only. It does not modify or delete historical reports or offers.
