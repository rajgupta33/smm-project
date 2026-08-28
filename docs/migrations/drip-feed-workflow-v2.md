# Drip-feed workflow v2 migration

Run from `backend/` after deploying the v2 worker code:

```powershell
npm run migrate:drip-feed
npm run migrate:drip-feed -- --apply
```

The first command is a dry run. Review its counts before applying.

Active legacy schedules are not resumed automatically because the old `PENDING` and `REJECTED` states cannot prove whether a provider accepted a request before a worker interruption. Applying the migration moves those schedules and their customer orders to reconciliation-required state without changing wallet funds. Completed and cancelled legacy parents remain terminal and receive the workflow version marker.

Do not run old and v2 workers concurrently. Remove or allow old-format `drip-feed-submit` Redis jobs to fail after all legacy active schedules have been placed in reconciliation; v2 jobs contain a `runId` and cannot consume the old `{ parentId, runNumber }` payload.
