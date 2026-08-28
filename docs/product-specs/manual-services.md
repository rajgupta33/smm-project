# Manual fulfilment

## Trust and accounting boundary

A customer may order a catalogue service only when the linked catalogue service has
`fulfilmentType=MANUAL`, is active, is not hidden, and the legacy compatibility service
is assigned to that customer. Pricing and the full wallet debit remain server-authoritative
and use the same pricing snapshot and wallet ledger as provider orders.

Manual orders do not create or dispatch a provider-submission job. The customer receives
`MANUAL_ORDER_ACCEPTED`, while an additive `ManualTask` is created in the same MongoDB
transaction as the funded order.

## Assignment and transitions

An unassigned `PENDING` task is claimed atomically by the current database administrator.
The same administrator may safely replay the claim; another administrator receives a
conflict and cannot overwrite the assignment.

Allowed transitions are:

```text
PENDING -> ASSIGNED (claim operation only)
ASSIGNED -> IN_PROGRESS | REJECTED | CANCELLED
IN_PROGRESS -> AWAITING_APPROVAL | COMPLETED | REJECTED | CANCELLED
AWAITING_APPROVAL -> IN_PROGRESS | COMPLETED | REJECTED | CANCELLED
```

`COMPLETED`, `REJECTED`, and `CANCELLED` are terminal and immutable. Only the assigned
administrator may update a non-terminal task. Optimistic concurrency protects against
two administrators racing on the same task document.

## Completion and refund

Completion changes the associated order to `COMPLETED` while retaining the original
wallet debit. Rejection or cancellation credits the exact immutable selling-total snapshot
through the centralized wallet service and changes the order funding state to `REFUNDED`.
The refund key is stable per order, so a request replay cannot issue a second credit.

Status and refund events are appended transactionally to the customer activity timeline.
Admin notes and proof details are not copied into customer-visible event metadata.

## Input limits

- Notes are trimmed and limited to 4,000 characters.
- Proof is optional, limited to 2,000 characters, and must be an HTTP(S) URL.
- Due dates must be valid dates and may be cleared.
- List pagination is bounded to 100 records per page.

