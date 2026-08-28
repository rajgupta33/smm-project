# Drip-feed orders

## Customer contract

- `quantity` is the quantity for each run. `runs` is between 1 and 100.
- More than one run requires an interval from 1 to 43,200 minutes.
- The backend validates the per-run quantity against the selected service and calculates the total quantity and full price.
- The wallet is debited once for the complete schedule. Browser totals are informational only.
- The first run is queued only after the order, parent schedule, run record, wallet debit, and outbox record commit together.

## Execution contract

- A run has one provider-submission attempt. `SCHEDULED -> SUBMITTING` is an atomic database claim.
- A confirmed provider acceptance persists the provider order ID and creates the next run plus its delayed outbox record in one transaction.
- BullMQ job IDs are `drip:<parentId>:<runNumber>`, have one attempt, and are delayed to the run's `runAt` time.
- A timeout, transport error, server error, malformed response, interrupted claimed attempt, or local persistence failure is ambiguous. The run, parent, and order stop in reconciliation-required state. There is no automatic retry, fallback provider, or refund.
- A definitive provider rejection cancels the remaining schedule. Only the parent charge not allocated to previously accepted runs is refunded, using one idempotent wallet ledger credit.
- Integer-paise allocation divides the parent charge across runs deterministically and distributes remainder paise from the first run onward.

## Current boundary

Provider routing for each run, an operator reconciliation action, schedule editing, and customer cancellation are later phases. The current implementation retains the provider mapping selected when the parent order was created.
