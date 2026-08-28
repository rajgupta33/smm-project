# Durable background jobs

The API and worker are separate processes backed by MongoDB and Redis/BullMQ.

```text
API transaction
  wallet debit + order/sync record + JobDispatch(PENDING)
        |
        v
best-effort immediate dispatcher ---- Redis unavailable ----> remains PENDING
        |                                      |
        v                                      v
BullMQ queue <----------------------- worker outbox polling
        |
        v
dedicated worker -> provider adapter -> terminal DB state
```

`JobDispatch.jobKey` is unique in MongoDB and is also the BullMQ job ID. A dispatcher lease permits multiple worker processes while recovering abandoned dispatch attempts. If Redis accepts a job but MongoDB cannot record `ENQUEUED`, adding the same job ID after the lease expires is deduplicated while retained. After BullMQ retention expires, database order/sync states remain the final idempotency boundary.

Queue producers fail quickly and leave the outbox pending. Workers use persistent Redis reconnection and graceful shutdown. Redis must be configured with `maxmemory-policy=noeviction`; evicting BullMQ keys can corrupt queue guarantees.

## Queues and retry policy

| Queue | Job | Attempts | External-side-effect policy |
|---|---|---:|---|
| `provider-order-submit` | `submit-order` | 1 | Never retry an ambiguous provider submission. An interrupted claimed attempt requires reconciliation. |
| `drip-feed-submit` | `submit-drip-feed` | 1 | Delayed per-run jobs claim one provider attempt. Only confirmed acceptance schedules the next run; ambiguity pauses the parent. |
| `provider-sync` | `sync-provider-report` | 3 | Report-only fetch may retry transient failures with exponential backoff. Non-retryable configuration failures stop immediately. |

Completed jobs are retained for up to seven days/10,000 jobs and failed jobs for up to thirty days/10,000 jobs. MongoDB outbox and business-state uniqueness remain authoritative.

## Runtime

Configure `REDIS_URL` (`redis://` or TLS `rediss://`) and optionally `BULLMQ_PREFIX`. Start both processes from `backend/`:

```powershell
npm start
npm run worker
```

Deployments must run at least one continuously available worker. Serverless API instances do not process jobs. Monitor `PENDING`/`DISPATCHING` records through `GET /api/admin/operations/jobDispatches`, BullMQ failed jobs, `ProviderSyncRun` failures, and `RECONCILIATION_REQUIRED` orders.

Before enabling traffic, verify Redis persistence/availability and `noeviction`, run an enqueue/worker smoke test in staging, stop Redis to verify outbox recovery, interrupt a claimed test submission to verify reconciliation, and confirm graceful worker shutdown.

## Upgrade from the synchronous runtime

Stop order-writing traffic and the old backend before migration. From `backend/`, inspect legacy pending states first:

```powershell
npm run migrate:job-dispatch
```

After reviewing the counts, apply once:

```powershell
npm run migrate:job-dispatch -- --apply
```

The migration creates outbox jobs only for `INTENT_COMMITTED` orders with no claimed submission attempt. Existing `SUBMITTING` orders are ambiguous and are moved to reconciliation, never enqueued. Queued/running report-only sync runs receive idempotent outbox records. Start the worker after the apply completes; rerunning the migration is safe because `jobKey` is unique.
