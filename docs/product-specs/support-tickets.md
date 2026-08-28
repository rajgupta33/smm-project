# Support tickets

## Scope and trust boundary

Support conversations are stored in additive `Ticket` and `TicketMessage` collections.
Customers address tickets with an opaque `publicTicketId`; MongoDB identifiers and
provider ticket references are not customer-facing identifiers.

The browser may supply a category, a public order ID, message text, attachment
references, and an idempotency key. The backend owns priority, status, assignment,
customer identity, and provider references. `DROP`, `PARTIAL`, `STUCK_ORDER`,
`WRONG_SERVICE`, and `CANCELLATION` tickets require an order. That order is resolved
by both its public ID and the authenticated database user, so another customer's
order cannot be attached to a ticket.

Payment, refund, and stuck-order tickets start at high priority. All other new
tickets start at normal priority. Customers cannot set or change priority,
assignment, status, provider references, or internal-note visibility.

## Conversation and state

Ticket states are `OPEN`, `WAITING_FOR_SUPPORT`, `WAITING_FOR_CUSTOMER`, `RESOLVED`,
and `CLOSED`. A customer reply moves a ticket to `WAITING_FOR_SUPPORT`; a visible
admin reply moves it to `WAITING_FOR_CUSTOMER`. Internal admin notes do not change
the customer-facing state. Closed tickets reject new messages until an admin
explicitly changes the state.

Customer detail queries always include the authenticated user and exclude
`internalOnly` messages. Provider references, assignee identities, and internal
system events are returned only by admin endpoints protected by the database-backed
admin role. Administrative state changes write an immutable internal system message
in the same transaction as the ticket update.

Every create, reply, and admin update requires an `Idempotency-Key`. Unique database
indexes protect ticket creation per customer and message/update execution per
ticket. Reusing a key with different content returns a conflict rather than applying
a second mutation.

Messages are stored as plain text and rendered by React. Attachment input is limited
to five HTTPS references with bounded metadata and a 10 MiB declared size per item.
The current UI does not upload or render attachments; issuing trusted upload URLs,
malware scanning, and storage lifecycle controls must be completed before attachment
upload is exposed to customers.

## APIs

Customer endpoints require authentication and CSRF protection:

- `POST /api/user/tickets`;
- `GET /api/user/tickets`;
- `GET /api/user/tickets/:publicTicketId`;
- `POST /api/user/tickets/:publicTicketId/messages`.

Admin endpoints require the current database user to have the admin role:

- `GET /api/admin/tickets?status=...&priority=...&category=...&assignedTo=...`;
- `GET /api/admin/tickets/:publicTicketId`;
- `POST /api/admin/tickets/:publicTicketId/messages`;
- `PATCH /api/admin/tickets/:publicTicketId`.

Ticket creation and messages have no automatic provider, refund, wallet, or order
side effects. Those actions remain in their authoritative workflows and require
their own reconciliation and audit controls.

## Deployment

Create and verify the `Ticket` and `TicketMessage` unique indexes before enabling
the navigation links. The API requires a MongoDB deployment with multi-document
transaction support. Validate duplicate-click, lost-response replay, cross-customer
order access, internal-note visibility, closed-ticket, assignment, and concurrent
message cases in staging.
