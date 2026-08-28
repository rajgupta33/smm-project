# Phase 9 - manual-priority multi-provider routing

Status: complete on 2026-08-29.

## Delivered

- Provider-specific adapter instances using each provider's API URL, timeout, and environment-backed credential reference.
- Admin provider creation/update endpoints that never accept or return raw API keys and create audit records.
- Explicit primary/fallback validation against enabled providers and available offers covering the complete catalogue range.
- Manual-priority selection by catalogue mapping and requested quantity; multiple unconfigured offers fail closed.
- Stable customer selling price with the selected offer's actual cost and gross spread captured in the immutable order price snapshot.
- Provider-specific order, drip-feed, refill, status, and report-only sync execution.
- Admin provider/routing page with report-only sync triggers.
- Automatic cost/quality routing remains disabled, and fallback is never attempted after a provider call begins.

## Deferred

- Automated health-based routing, scoring, or provider failover.

Reviewed synchronization report application was completed in Phase 10.
Operator resolution for ambiguous provider attempts was completed in Phase 11.
