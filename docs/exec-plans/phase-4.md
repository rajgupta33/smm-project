# Phase 4: Redis and BullMQ worker

Status: implementation complete; infrastructure deployment and staging failure tests remain operational steps.

Delivered:

- BullMQ 6 and ioredis integration with explicit producer/worker connection policies;
- separate `npm run worker` process and graceful shutdown;
- transactional MongoDB outbox with unique job keys, dispatch leases, and recovery polling;
- queued provider order submission with a single external attempt;
- queued report-only provider synchronization with bounded safe retries;
- interrupted/ambiguous order reconciliation without refund, resubmit, or failover;
- admin inspection for job dispatch and reconciliation states;
- frontend queued-order messaging.

Deliberately deferred:

- automatic provider failover;
- automatic reconciliation decisions or provider resubmission;
- scheduled catalogue synchronization;
- status, refill, payment, notification, or maintenance queues;
- Redis infrastructure provisioning inside this repository.
