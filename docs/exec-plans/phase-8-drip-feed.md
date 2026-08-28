# Phase 8 - durable drip-feed execution

Status: complete on 2026-08-29.

## Delivered

- Transactional creation of the parent schedule, first run, and queue outbox.
- Durable delayed BullMQ dispatch with database uniqueness per parent and run number.
- One-attempt run state machine with explicit accepted, definitively rejected, and ambiguous outcomes.
- Reconciliation stops for provider ambiguity, interrupted workers, and persistence failures.
- Exact integer-paise allocation and idempotent refund of only unexecuted value after definitive rejection.
- Customer form fields for runs and interval, with backend-authoritative limits and pricing.
- Additive legacy migration that marks active pre-v2 schedules for reconciliation instead of risking duplicate provider submission.

## Deferred

- Per-run provider routing and fallback policy.
- Operator actions to resolve drip-feed reconciliation cases.
- Customer cancellation and schedule editing.
