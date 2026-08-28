# Phase 6 execution record — support-ticket slice

Implemented the second Phase 6 slice: additive `Ticket` and `TicketMessage` models,
opaque public IDs, customer/order ownership enforcement, transactional conversations,
database-backed idempotency, private admin notes, assignment and status controls,
customer support UI, and an authorized admin ticket workspace.

Ticket operations intentionally do not mutate orders, issue refunds, adjust wallets,
or submit provider requests. Attachment-reference storage is bounded at the API, but
customer upload and rendering remain disabled until a trusted upload/scanning flow is
introduced.

The combined customer order activity timeline remains the next Phase 6 slice. It
will merge immutable order events with provider status, refill updates, visible
ticket updates, refunds, and customer-visible messages without exposing internal
provider or admin data.
