# SMM PANEL — MASTER IMPLEMENTATION PLAN FOR CODEX

## Objective

Upgrade the existing SMM Panel from its current working prototype into a secure, production-ready, multi-provider commerce and fulfilment platform.

The current application already has a React/Vite frontend, Node.js/Express backend, MongoDB/Mongoose database, JWT/cookie authentication, user/admin flows, service management, wallet balances, order placement, provider status/refill operations and transaction history.

Do **not** rewrite the application from scratch.

The existing technical assessment specifically concluded that the backend is compact enough to refactor and that the biggest issues are authorization, server-side pricing, wallet integrity, provider-order reliability and lack of durable background processing.

---

# 1. CODEX EXECUTION RULES

Codex must follow these rules throughout the implementation.

## 1.1 Do not implement everything in one change

Work phase-by-phase.

Each phase must:

1. inspect the existing implementation;
2. document affected files;
3. create/update tests;
4. make the smallest safe migration;
5. run lint;
6. run frontend build;
7. run backend tests;
8. report changed files;
9. report database migrations/indexes introduced;
10. report required environment variables;
11. stop before beginning the next major phase.

Do not silently refactor unrelated working code.

---

## 1.2 First action: repository audit

Before modifying anything, inspect:

- repository root;
- existing `AGENTS.md`;
- frontend package.json;
- backend package.json;
- lockfiles;
- frontend/src/App.jsx;
- frontend/src/context/Authcontext.jsx;
- frontend/src/service/api.js;
- frontend pages/components/cards;
- backend/index.js;
- backend/api/index.js;
- backend routes;
- backend controllers;
- backend middleware;
- backend models;
- MongoDB connection helpers;
- provider API integration;
- `.env.example`;
- Vercel configuration;
- existing deployment configuration;
- current Git status;
- current tests;
- ESLint configuration.

Create:

`docs/architecture/current-state.md`

and document the actual existing architecture before changing it.

Do not assume filenames that do not exist.

Map this implementation specification onto the repository's actual naming.

---

# 2. CREATE CODEX PROJECT INSTRUCTIONS

Create a concise root:

`AGENTS.md`

It should tell future Codex runs:

- React frontend location;
- Express backend location;
- MongoDB/Mongoose usage;
- how to run frontend;
- how to run backend;
- how to run lint;
- how to run tests;
- how to build;
- environment-variable rules;
- never place secrets in source code;
- never trust browser-supplied prices;
- all money stored in integer paise;
- wallet activity uses immutable ledger;
- privileged API routes require backend authorization;
- provider IDs are not customer-facing service IDs;
- provider timeouts must not trigger blind duplicate order submission;
- Cashfree wallet credits occur only after verified server-side confirmation;
- background jobs must be idempotent;
- migrations must preserve historical orders.

Also create:

`docs/architecture/target-architecture.md`

`docs/exec-plans/`

`docs/product-specs/pricing.md`

`docs/product-specs/wallet.md`

`docs/product-specs/providers.md`

`docs/product-specs/payments.md`

`docs/product-specs/orders.md`

This documentation becomes the permanent architecture reference.

---

# 3. TARGET SYSTEM ARCHITECTURE

Target architecture:

```text
React Frontend
      |
      v
Express API
      |
      +----------------------+
      |                      |
      v                      v
 MongoDB                Redis/BullMQ
                             |
                             v
                      Background Worker
                             |
           +-----------------+----------------+
           |                 |                |
           v                 v                v
      Provider A        Provider B       Future Provider
```

Business architecture:

```text
Customer
   |
   v
CatalogueService
   |
   v
Pricing Engine
   |
   v
Order Engine
   |
   +--------------+
   |              |
   v              v
Wallet         Payment
Ledger         Cashfree
   |
   v
Fulfilment Router
   |
   +----------+----------+
   |          |          |
Provider A Provider B Manual
```

The technical assessment already identifies the need to separate a stable catalogue from provider-specific service IDs.

---

# 4. PHASE 0 — SECURITY AND FINANCIAL STABILIZATION

This phase is mandatory before adding new production payment functionality.

The assessment identified browser-controlled order totals, incomplete admin authorization, unsafe wallet adjustment, order-ownership gaps and unsafe provider side effects as P0 issues.

---

# 5. BACKEND AUTHORIZATION

## 5.1 Create centralized authentication middleware

Separate:

`authenticate`

from:

`requireAdmin`

Conceptually:

```text
request
  ↓
authenticate
  ↓
load current user
  ↓
requireAdmin
  ↓
controller
```

Do not authorize an administrator purely from a role value embedded permanently in an old JWT.

For sensitive actions, load the current user record from MongoDB.

---

## 5.2 User role

Modify User schema.

Allowed roles:

```text
user
admin
```

Use enum validation.

Future roles may include:

```text
support
operations
finance
```

but do not implement them now unless already needed.

---

## 5.3 Protect every privileged operation

Audit every route under:

`/api/admin`

and any privileged route elsewhere.

Operations requiring admin authorization include at minimum:

- create user;
- delete/deactivate user;
- reset user password;
- add/remove user service;
- wallet adjustment;
- service creation;
- service modification;
- provider configuration;
- provider synchronization trigger;
- markup configuration;
- payment inspection;
- manual refunds;
- order administration.

Create authorization integration tests proving normal users receive 403.

Frontend admin-route protection must remain, but backend authorization is authoritative.

---

# 6. SERVER-SIDE ORDER VALIDATION

The existing assessment found that order placement accepts browser-provided `rate` and `totalAmount`, allowing manipulated prices and quantities.

Remove that trust completely.

Frontend may display calculated prices.

Frontend must **not** determine the authoritative charge.

For order submission, browser should send only the minimum required values such as:

```json
{
  "catalogueServiceId": "...",
  "quantity": 5000,
  "target": "https://..."
}
```

Backend must independently:

1. identify authenticated user;
2. load CatalogueService;
3. verify service is active;
4. verify user is allowed to use it;
5. determine valid ProviderOffer;
6. validate quantity;
7. determine current provider cost;
8. determine effective admin markup;
9. calculate selling rate;
10. calculate final order amount;
11. verify wallet;
12. create price snapshot;
13. continue order workflow.

Reject:

- zero quantity;
- negative quantity;
- NaN;
- Infinity;
- decimals where service requires integers;
- quantity below min;
- quantity above max;
- inactive service;
- service not assigned to customer;
- unavailable provider offer;
- malformed target.

---

# 7. ADMIN MARKUP PRICING ENGINE

This is a required new feature.

## 7.1 Definition

The administrator controls a markup percentage `X`.

Markup is added **on top of provider cost**.

Formula:

```text
Selling Rate =
Provider Cost × (1 + X / 100)
```

Example:

```text
Provider cost = ₹100
Markup X = 25%

Selling rate =
₹100 × 1.25
= ₹125
```

Do NOT implement:

```text
₹100 × 25% = ₹25
```

as the final customer price.

₹25 is only the markup component.

---

# 8. MONEY REPRESENTATION

Do not use JavaScript floating-point rupee amounts for authoritative financial accounting.

Store money in integer minor units:

```text
₹1 = 100 paise
```

Examples:

```text
₹100.00 = 10000
₹1.25   = 125
```

The existing roadmap also recommends integer minor units and versioned server-side pricing.

---

# 9. MARKUP REPRESENTATION

Avoid floating-point percentage errors.

Store markup in basis points.

Examples:

```text
1%    = 100 basis points
10%   = 1000 basis points
25%   = 2500 basis points
37.5% = 3750 basis points
```

Suggested field:

```text
markupBps
```

Admin interface may display normal percentages.

---

# 10. GLOBAL PRICING SETTINGS

Create model:

`PricingSettings`

Suggested fields:

```text
globalMarkupBps
currency
pricingUnit
minimumMarginBps
updatedBy
updatedAt
version
```

Default:

```text
currency = INR
pricingUnit = 1000
```

Do not hardcode a markup percentage.

Admin must control it.

---

# 11. SERVICE-SPECIFIC MARKUP OVERRIDE

CatalogueService should optionally support:

```text
markupOverrideBps
```

Pricing hierarchy:

```text
CatalogueService markup override
        ↓
if absent
        ↓
Global admin markup
```

Do not implement customer-specific markup during the first migration unless existing business requirements already need it.

Structure the pricing engine so customer-specific pricing can be added later.

---

# 12. PRICING ENGINE SERVICE

Create a dedicated backend domain module such as:

`services/pricingService.js`

or according to repository conventions.

It should expose functions conceptually equivalent to:

```text
getEffectiveMarkup()
calculateSellingRate()
calculateOrderTotal()
createPriceSnapshot()
```

Controllers should not contain duplicate pricing formulas.

---

# 13. RATE CALCULATION

If provider rate represents price per 1,000 units:

```text
providerRateMinor = provider rate per 1000
```

Selling rate:

```text
sellingRateMinor =
ceil(
 providerRateMinor *
 (10000 + markupBps)
 / 10000
)
```

Order total:

```text
orderTotalMinor =
ceil(
 sellingRateMinor *
 quantity /
 pricingUnit
)
```

Use one consistent rounding policy.

Recommended:

**round customer charges upward to the nearest paise**.

Write unit tests for:

- 0% markup;
- 1%;
- 10%;
- 25%;
- 37.5%;
- 100%;
- large quantities;
- tiny provider rates;
- odd paise values.

---

# 14. PRICE SNAPSHOT

Every order must permanently store the pricing values used at purchase time.

Suggested order pricing snapshot:

```text
providerCostRateMinor
sellingRateMinor
markupBps
pricingUnit
quantity
providerCostTotalMinor
sellingTotalMinor
currency
pricingVersion
pricedAt
```

If admin changes markup tomorrow, historical orders must not change.

---

# 15. ADMIN MARKUP UI

Create an Admin Pricing Settings page.

Display:

```text
Global Markup (%)
```

Admin enters:

```text
25
```

System stores:

```text
2500 BPS
```

Show preview:

```text
Provider Rate: ₹100 / 1000
Markup: 25%
Customer Rate: ₹125 / 1000
```

Admin should have:

- Save;
- confirmation;
- validation;
- audit history.

Recommended allowed initial range:

```text
0% to 1000%
```

Make the limit configurable.

Do not accept negative markup without an explicit future discount feature.

---

# 16. MARKUP AUDIT LOG

Every change must record:

```text
oldMarkup
newMarkup
adminUserId
timestamp
requestId
```

Create general AuditLog support if practical.

---

# 17. WALLET LEDGER

Current balance management must be replaced with an immutable ledger.

The existing implementation was assessed as vulnerable to lost concurrent updates and duplicate balance manipulation.

Create:

`WalletLedger`

Suggested schema:

```text
_id

userId

direction:
  CREDIT
  DEBIT

type:
  PAYMENT
  ORDER
  REFUND
  ADMIN_ADJUSTMENT
  PROMOTIONAL
  REVERSAL

amountMinor

currency

balanceBeforeMinor
balanceAfterMinor

sourceType
sourceId

idempotencyKey

actorType
actorId

description

createdAt
```

Create unique index:

```text
idempotencyKey UNIQUE
```

---

# 18. USER WALLET BALANCE

User may retain:

```text
walletBalanceMinor
```

for fast access.

But it is a cached balance, not the accounting history.

Every mutation must atomically:

1. create WalletLedger entry;
2. update User.walletBalanceMinor.

Use MongoDB transaction where multiple documents must remain consistent.

MongoDB supports transactions for atomic multi-document changes, while `$inc` is safer than read-then-set for concurrent balance updates.

---

# 19. WALLET SERVICE

Centralize money mutations.

Suggested:

`services/walletService.js`

Methods conceptually:

```text
creditWallet()
debitWallet()
refundWallet()
adminAdjustWallet()
getWalletStatement()
reconcileWallet()
```

Controllers must never modify wallet balance directly.

---

# 20. DEBIT SAFETY

Order debit must be conditional.

Conceptually:

```text
walletBalance >= requiredAmount
```

and perform atomic `$inc`.

Never:

```text
balance = readBalance
balance = balance - amount
save(balance)
```

because concurrent orders can overwrite each other.

---

# 21. ADMIN WALLET ADJUSTMENTS

Admin adjustments require:

- admin authorization;
- reason;
- amount;
- CREDIT/DEBIT;
- immutable ledger record;
- audit log;
- idempotency key.

Never allow deleting wallet history.

Correction must create reversal entries.

---

# 22. AUTHENTICATION HARDENING

Remove fallback JWT secrets.

Application must fail startup if required secrets are absent.

Add:

- login rate limiting;
- secure cookies;
- production cookie settings;
- allowed origins;
- CSRF protection appropriate to final cookie/domain architecture;
- secure password reset;
- audit logs.

Never expose plaintext passwords in admin API responses.

---

# 23. FRONTEND CURRENT BUG FIXES

Fix existing known runtime problems before major feature development.

Assessment identified at least:

- missing `serviceApi` import in password/profile path;
- toast ID scope problem in order form;
- inconsistent API-success handling;
- stale wallet UI;
- misleading transaction status.

Fix and cover them with tests.

---

# 24. PHASE 1 — ENGINEERING FOUNDATION

After Phase 0 passes:

- clean ESLint;
- introduce backend tests;
- introduce frontend tests;
- centralize error handling;
- centralize API response shape;
- remove hardcoded production API URL;
- create development/staging/production configuration;
- remove unused/deprecated dependencies where safe;
- remove generated frontend `dist` from source control if still tracked.

The previous assessment found 21 lint errors, 6 warnings and no automated test suite, so testing must become a release gate.

---

# 25. STANDARD API RESPONSE

Adopt one response shape.

Success:

```json
{
  "success": true,
  "data": {}
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Insufficient wallet balance"
  }
}
```

Add request IDs.

Do not leak internal stack traces to customers.

---

# 26. PHASE 2 — CATALOGUE AND MULTI-PROVIDER ARCHITECTURE

Create separate entities:

```text
CatalogueService
Provider
ProviderOffer
ProviderSyncRun
```

---

# 27. CATALOGUE SERVICE

Suggested:

```text
CatalogueService

slug
displayName
platform
category
description

pricingUnit

min
max

markupOverrideBps

refillPolicy

fulfilmentType:
  PROVIDER
  MANUAL
  CUSTOM_AUTOMATION

active
visibility

createdAt
updatedAt
```

`min` and `max` must be numeric.

---

# 28. PROVIDER

Suggested schema:

```text
Provider

name
adapterType
apiBaseUrl

credentialReference

enabled

priority

healthStatus

lastSuccessfulSyncAt
lastFailureAt

timeoutMs

createdAt
updatedAt
```

Never return provider secrets to frontend.

Never put API keys in CatalogueService.

---

# 29. PROVIDER OFFER

Suggested:

```text
ProviderOffer

providerId
providerServiceId
catalogueServiceId

providerNameSnapshot
providerCategorySnapshot
providerDescriptionSnapshot

costRateMinor
pricingUnit

min
max

supportsRefill

availability:
  AVAILABLE
  SUSPECTED_UNAVAILABLE
  UNAVAILABLE

lastSeenAt

qualityScore

createdAt
updatedAt
```

Create compound unique index:

```text
providerId + providerServiceId
```

---

# 30. PROVIDER ADAPTER INTERFACE

All providers implement one common contract:

```text
getServices()
placeOrder()
getOrderStatus()
requestRefill()
getRefillStatus()
```

Optional:

```text
createTicket()
getTicket()
getBalance()
```

Provider-specific request/response formats must stay inside adapters.

---

# 31. FIRST PROVIDER MIGRATION

Wrap the existing provider API in an adapter without changing its external behavior first.

Do not add Provider B until Provider A works through the adapter.

Steps:

1. create adapter interface;
2. wrap current provider;
3. regression-test current ordering;
4. migrate service references;
5. only then implement second provider.

---

# 32. PROVIDER SERVICE SYNCHRONIZATION

Create sync process.

For each provider:

1. fetch service list;
2. normalize response;
3. upsert ProviderOffers;
4. compare cost;
5. compare min/max;
6. compare refill support;
7. update lastSeenAt;
8. log new services;
9. log changed services;
10. log missing services.

Do not automatically delete offers.

Missing once:

```text
SUSPECTED_UNAVAILABLE
```

Missing repeatedly:

```text
UNAVAILABLE
```

---

# 33. MARKUP + PROVIDER SYNC

This is important.

When provider cost changes:

```text
new provider rate
     ↓
pricing engine
     ↓
new calculated selling rate
```

If service uses automatic markup pricing.

Example:

```text
Old provider rate = ₹100
Markup = 25%
Customer rate = ₹125

Provider changes to ₹120

New customer rate =
₹120 × 1.25
= ₹150
```

Admin dashboard should show:

```text
Previous cost
New cost
Markup
Previous selling rate
New calculated selling rate
Margin change
```

---

# 34. PRICE CHANGE SAFEGUARD

Do not silently apply extreme provider price changes.

Create configurable threshold.

Example:

```text
provider price changes > 20%
```

Then flag:

```text
PRICE_REVIEW_REQUIRED
```

Admin can approve.

Also automatically pause a service if:

```text
calculated margin becomes unsafe
```

according to configured policy.

---

# 35. PHASE 3 — ORDER ENGINE

Create explicit order lifecycle.

Suggested:

```text
DRAFT
VALIDATED
FUNDS_RESERVED
SUBMISSION_PENDING
PROVIDER_ACCEPTED
IN_PROGRESS
PARTIAL
COMPLETED
RECONCILIATION_REQUIRED
FAILED
CANCELLED
REFUNDING
REFUNDED
```

---

# 36. ORDER MODEL

Suggested additions:

```text
publicOrderId

userId

catalogueServiceId

providerId
providerOfferId
providerOrderId

target
quantity

pricingSnapshot

status

fulfilmentType

submissionAttempts

providerResponseSnapshot

createdAt
updatedAt
completedAt
```

Never use `providerOrderId` as authorization.

---

# 37. ORDER OWNERSHIP

Every customer:

- status request;
- refill request;
- cancellation;
- ticket;
- activity request;

must query by both:

```text
authenticated user
+
local order ID
```

The previous assessment explicitly identified ownership validation as required.

---

# 38. ORDER EVENT MODEL

Create:

`OrderEvent`

Immutable timeline.

Suggested events:

```text
ORDER_CREATED
PRICE_CALCULATED
FUNDS_RESERVED
PROVIDER_SUBMISSION_STARTED
PROVIDER_ACCEPTED
STATUS_CHANGED
PARTIAL
REFILL_REQUESTED
REFILL_COMPLETED
TICKET_CREATED
REFUND_STARTED
REFUND_COMPLETED
ADMIN_NOTE
```

This powers both support and customer activity timeline.

---

# 39. PROVIDER ORDER SAFETY

Do not call provider and database transaction as if they were one atomic system.

Provider API cannot participate in MongoDB transaction.

Safer sequence:

```text
Validate
   ↓
Reserve funds
   ↓
Create local order
   ↓
Commit
   ↓
Queue provider submission
   ↓
Call provider
   ↓
Record accepted/ambiguous/failed
```

On ambiguous timeout:

```text
RECONCILIATION_REQUIRED
```

Do NOT immediately submit to another provider.

---

# 40. PHASE 4 — REDIS + BULLMQ WORKER

Add Redis-compatible managed service.

Add BullMQ.

Create separate worker process.

Suggested queues:

```text
provider-sync
provider-order-submit
order-status
payment-reconcile
refill
drip-feed
notifications
maintenance
```

BullMQ currently supports delayed jobs, job retries and deduplication; jobs should also be designed to be idempotent so retries do not produce duplicate external side effects.

---

# 41. JOB IDEMPOTENCY

Examples:

Provider submission:

```text
provider-submit:<localOrderId>
```

Payment processing:

```text
cashfree:<paymentId>
```

Refill:

```text
refill:<refillRequestId>
```

Drip run:

```text
drip:<parentOrderId>:<runNumber>
```

Use database uniqueness as final protection, not Redis alone.

---

# 42. JOB RETRY POLICY

Retry only known-retryable conditions such as:

- network connection failure;
- temporary HTTP 5xx;
- rate limit where retry-after is known.

Do not automatically retry:

- invalid service;
- invalid quantity;
- insufficient funds;
- provider explicit rejection;
- ambiguous provider acceptance.

Ambiguous external results require reconciliation.

---

# 43. PHASE 5 — CASHFREE WALLET TOP-UP

The Cashfree merchant account is already working.

Therefore merchant onboarding is not an implementation blocker.

Still implement/test sandbox mode before enabling production wallet credits.

---

# 44. CASHFREE ENVIRONMENT VARIABLES

Server-side only:

```text
CASHFREE_APP_ID
CASHFREE_SECRET_KEY
CASHFREE_ENV
CASHFREE_API_VERSION
CASHFREE_WEBHOOK_SECRET / required verification configuration
CASHFREE_RETURN_URL
CASHFREE_NOTIFY_URL
```

Use exact variables required by the selected current Cashfree SDK/API.

Never expose App Secret in React/Vite variables.

---

# 45. PAYMENT MODEL

Create:

`Payment`

Suggested fields:

```text
userId

merchantOrderId

gateway:
  CASHFREE

gatewayOrderId

gatewayPaymentId

paymentSessionId

amountMinor
currency

status:
  CREATED
  PENDING
  SUCCESS
  FAILED
  EXPIRED
  REFUNDED
  DISPUTED

creditedAt

walletLedgerId

idempotencyKey

gatewayResponseSnapshot

createdAt
updatedAt
```

Unique indexes:

```text
merchantOrderId
gatewayPaymentId where appropriate
idempotencyKey
```

---

# 46. CASHFREE CREATE-ORDER FLOW

Customer:

```text
Add Money
```

Frontend asks backend:

```text
POST /api/payments/cashfree/order
```

Payload:

```json
{
  "amount": 1000
}
```

Backend:

1. authenticates user;
2. validates minimum/maximum top-up;
3. converts amount to paise;
4. creates local Payment = CREATED/PENDING;
5. generates unique merchant order ID;
6. calls Cashfree server-side Create Order;
7. stores gateway identifiers;
8. returns only safe checkout information including `payment_session_id`.

Cashfree currently documents server-side order creation followed by use of the resulting payment-session ID in its web checkout.

---

# 47. CASHFREE FRONTEND

Create Wallet Top-Up page/modal.

User enters amount.

Display:

```text
₹500
₹1,000
₹2,000
Custom
```

Backend defines min/max.

Frontend must not be trusted for amount validation.

Use Cashfree hosted checkout/popup.

Dynamic UPI/QR may be used through supported Cashfree checkout experience.

---

# 48. CASHFREE RETURN URL

Return URL is user experience only.

It must NEVER credit wallet.

After redirect:

frontend displays:

```text
Checking payment...
```

then asks backend for payment status.

---

# 49. CASHFREE WEBHOOK

Create dedicated endpoint.

Example:

```text
POST /api/webhooks/cashfree
```

Important:

Preserve raw request body where required for signature validation.

Verify current Cashfree:

- webhook signature;
- timestamp;
- event;
- order identity;
- amount;
- currency;
- payment status.

Cashfree's current documentation explicitly requires webhook signature verification before acting on webhook data.

---

# 50. CASHFREE CREDIT TRANSACTION

On verified SUCCESS:

start MongoDB transaction.

1. find Payment;
2. validate user;
3. validate amount;
4. verify not already credited;
5. create WalletLedger CREDIT;
6. atomically increment wallet;
7. update Payment SUCCESS;
8. set creditedAt;
9. commit.

Repeated webhook must return success without another credit.

---

# 51. PAYMENT IDEMPOTENCY

Use gateway payment identifier and/or stable Cashfree event/payment reference.

Database uniqueness must ensure:

```text
one successful external payment
=
one wallet credit
```

even if webhook arrives 10 times.

---

# 52. CASHFREE RECONCILIATION

Create scheduled worker.

Check:

```text
PENDING payments older than threshold
```

against Cashfree server API.

Resolve:

- successful but webhook missed;
- pending;
- failed;
- refunded;
- disputed.

Never depend only on browser return.

---

# 53. CASHFREE ADMIN PAGE

Create:

Admin → Payments

Columns:

```text
Payment ID
Customer
Amount
Gateway
Status
Created
Gateway Reference
Wallet Credited
```

Filters:

```text
Pending
Success
Failed
Refunded
Disputed
```

Provide reconciliation action for authorized admin.

Do not manually mark a payment successful without an explicit audited emergency process.

---

# 54. PHASE 6 — REFILL SYSTEM

Create:

`RefillRequest`

Fields:

```text
orderId
userId
providerId
providerOrderId

status

requestedAt
eligibilitySnapshot

providerRefillId

cooldownUntil
expiresAt

failureReason

createdAt
updatedAt
```

Statuses:

```text
REQUESTED
VALIDATING
SENT_TO_PROVIDER
IN_PROGRESS
COMPLETED
REJECTED
FAILED
EXPIRED
NEEDS_SUPPORT
```

Eligibility:

- order belongs to customer;
- provider supports refill;
- order status eligible;
- guarantee active;
- cooldown complete;
- no pending refill;
- provider still considers order eligible.

The planned refill workflow in the assessment follows this model rather than a simple proxy button.

---

# 55. SUPPORT TICKET SYSTEM

Create:

`Ticket`

and:

`TicketMessage`

Ticket fields:

```text
publicTicketId
userId
orderId
category
priority
status
assignedTo
providerTicketReference
createdAt
updatedAt
```

Categories:

```text
DROP
PARTIAL
STUCK_ORDER
WRONG_SERVICE
CANCELLATION
PAYMENT
REFUND
OTHER
```

Message fields:

```text
ticketId
senderType
senderId
message
attachments
internalOnly
createdAt
```

---

# 56. CUSTOMER ACTIVITY TIMELINE

Order detail page should combine:

- order events;
- provider status;
- refill updates;
- ticket updates;
- refunds;
- drip-feed runs;
- admin/customer-visible messages.

---

# 57. PHASE 7 — MANUAL SERVICES

CatalogueService already has:

```text
fulfilmentType
```

Values:

```text
PROVIDER
MANUAL
CUSTOM_AUTOMATION
```

Manual order enters:

```text
ManualFulfilment queue
```

Admin fields:

```text
assignedTo
dueAt
notes
proof
status
```

Statuses:

```text
PENDING
ASSIGNED
IN_PROGRESS
AWAITING_APPROVAL
COMPLETED
REJECTED
CANCELLED
```

Reuse same:

- pricing;
- wallet;
- payment;
- order;
- refund;
- ticket;
- activity timeline.

Do not build separate accounting logic.

---

# 58. PHASE 8 — DRIP-FEED

Do this only after worker infrastructure and support workflows are stable.

Create:

`DripFeedOrder`

and:

`DripFeedRun`.

Parent:

```text
orderId
totalQuantity
quantityPerRun
totalRuns
completedRuns
intervalMinutes
nextRunAt
reservedAmountMinor
status
```

Run:

```text
parentId
runNumber
quantity
scheduledAt
providerId
providerOfferId
providerOrderId
pricingSnapshot
status
attemptCount
```

Create unique compound index:

```text
parentId + runNumber
```

---

# 59. DRIP-FEED FUNDING

Reserve/charge full customer amount when schedule begins.

Do not attempt to debit wallet independently for every future run.

This avoids future insufficient-funds inconsistencies.

Refund only unexecuted value according to policy.

---

# 60. DRIP-FEED SCHEDULING

Use BullMQ delayed jobs.

Example job identity:

```text
drip:<parentId>:<runNumber>
```

If worker restarts, database uniqueness must prevent duplicate provider submission.

---

# 61. MULTI-PROVIDER ROUTING

Initial version must use:

```text
MANUAL_PRIORITY
```

Admin chooses:

```text
Primary Provider
Fallback Provider
```

Do not immediately implement automatic cheapest-provider routing.

After sufficient provider metrics exist, add strategies:

```text
COST_AWARE
MARGIN_AWARE
QUALITY_AWARE
AVAILABILITY_AWARE
```

---

# 62. PROVIDER FAILOVER RULE

Never do:

```text
Provider A timeout
→ immediately send Provider B
```

A timeout may mean Provider A accepted the order but response was lost.

Instead:

```text
Provider A timeout
        ↓
RECONCILIATION_REQUIRED
        ↓
check provider status/order
        ↓
only then decide
```

The assessment specifically warns against blind provider failover because it can create two real orders for one customer purchase.

---

# 63. PROVIDER HEALTH METRICS

Collect:

```text
requestCount
successCount
failureCount
timeoutCount
averageLatency
lastSuccessAt
lastFailureAt
syncAge
```

Later derive quality score.

---

# 64. ADMIN DASHBOARD IMPROVEMENTS

Eventually create the following sections:

## Overview

- total customers;
- wallet liability;
- today's orders;
- today's revenue;
- provider cost;
- gross margin;
- pending payments;
- failed orders;
- reconciliation required.

## Pricing

- global markup;
- per-service overrides;
- provider cost;
- selling price;
- margin.

## Providers

- status;
- API latency;
- failures;
- latest sync;
- available services;
- provider balance where supported.

## Service Mapping

- unmapped new provider services;
- changed services;
- missing services;
- major price changes.

## Orders

- status;
- provider;
- margin;
- payment;
- reconciliation.

## Wallet

- immutable ledger;
- admin adjustments;
- reconciliation differences.

## Payments

- Cashfree payments;
- success/failure/pending;
- uncredited successful payments;
- refunds.

## Support

- tickets;
- refills;
- manual fulfilment.

The original roadmap already recommends provider-health, service-mapping, margin, reconciliation, ticket and wallet-audit dashboards.

---

# 65. CUSTOMER EXPERIENCE

Customer service card should clearly show:

```text
Service Name
Platform
Description
Min
Max
Expected Speed
Refill / Guarantee
Final Rate
```

Do not show:

```text
provider API key
provider internal cost
provider service ID
provider name
markup percentage
internal margin
```

unless business policy intentionally exposes any of them.

---

# 66. CUSTOMER ORDER FORM

Order form should:

1. select service;
2. enter link/username;
3. enter quantity;
4. request quote from backend or calculate preview from safe server-provided rate;
5. show final estimated amount;
6. submit order;
7. backend recalculates again;
8. backend returns authoritative charged amount.

If price changed between preview and submission beyond configurable tolerance, require reconfirmation.

---

# 67. QUOTE ENDPOINT

Optional recommended endpoint:

```text
POST /api/orders/quote
```

Payload:

```json
{
  "catalogueServiceId": "...",
  "quantity": 5000
}
```

Response:

```json
{
  "serviceId": "...",
  "quantity": 5000,
  "sellingRateMinor": 12500,
  "pricingUnit": 1000,
  "totalMinor": 62500,
  "currency": "INR",
  "quoteExpiresAt": "..."
}
```

Order endpoint must still recalculate.

Quote is not authorization.

---

# 68. DATABASE INDEXES

Codex must review query patterns and create indexes deliberately.

At minimum consider:

User:

```text
userId UNIQUE
email where applicable
role
```

WalletLedger:

```text
idempotencyKey UNIQUE
userId + createdAt
sourceType + sourceId
```

Payment:

```text
merchantOrderId UNIQUE
gatewayPaymentId
userId + createdAt
status
```

CatalogueService:

```text
slug UNIQUE
active
platform + category
```

ProviderOffer:

```text
providerId + providerServiceId UNIQUE
catalogueServiceId
availability
```

Order:

```text
publicOrderId UNIQUE
userId + createdAt
status + createdAt
providerOrderId where required
```

DripFeedRun:

```text
parentId + runNumber UNIQUE
```

MongoDB unique indexes should be used for hard duplicate protection rather than relying only on application checks.

---

# 69. OBSERVABILITY

Replace unstructured `console.log()` usage for critical operations.

Introduce structured logging.

Every request gets:

```text
requestId
```

Critical logs:

- login failure;
- admin mutation;
- markup change;
- wallet credit/debit;
- provider submission;
- provider timeout;
- payment webhook;
- payment reconciliation;
- refill;
- worker failure.

Never log secrets.

---

# 70. HEALTH ENDPOINTS

Create:

```text
/health
/ready
```

Health:

application alive.

Ready:

- MongoDB connectivity;
- essential configuration present.

Worker should have independent health monitoring.

Do not expose sensitive details publicly.

---

# 71. TESTING STRATEGY

## Authentication

Test:

- valid login;
- invalid login;
- expired token;
- logout;
- missing JWT secret;
- normal user blocked from admin APIs.

## Pricing

Test:

- 0% markup;
- admin markup;
- service override;
- provider rate update;
- min/max validation;
- manipulated frontend totals ignored;
- rounding.

## Wallet

Test:

- credit;
- debit;
- insufficient funds;
- concurrent debits;
- duplicate idempotency key;
- refund;
- admin adjustment;
- rollback.

## Provider

Test:

- accepted;
- rejected;
- timeout;
- invalid response;
- provider unavailable;
- duplicate submission protection;
- reconciliation.

## Cashfree

Test:

- order creation;
- valid webhook signature;
- invalid signature;
- wrong amount;
- wrong payment;
- duplicate webhook;
- success;
- failure;
- delayed success;
- reconciliation;
- refund.

## Worker

Test:

- restart;
- retry;
- duplicate job;
- delayed job;
- dead job;
- provider timeout;
- Redis outage/recovery where practical.

## Drip Feed

Test:

- valid schedule;
- duplicate run;
- pause;
- cancellation;
- partial completion;
- refund unexecuted portion.

---

# 72. SECURITY TEST CASE: PRICE MANIPULATION

Explicitly create a test that submits:

```json
{
  "serviceId": "valid-service",
  "quantity": 10000,
  "rate": 0,
  "totalAmount": -100000
}
```

Backend must ignore unauthorized price fields entirely.

Expected result:

server calculates genuine price.

Better still, request-validation schema rejects unknown financial fields.

---

# 73. SECURITY TEST CASE: ADMIN API

Login as normal customer.

Manually call every `/api/admin/*` route.

Expected:

```text
403 Forbidden
```

No mutation.

---

# 74. CONCURRENCY TEST

User wallet:

```text
₹1,000
```

Simultaneously submit:

```text
Order A = ₹700
Order B = ₹700
```

Expected:

exactly one succeeds.

Final wallet:

```text
₹300
```

No negative wallet.

Exactly one debit ledger entry.

---

# 75. PAYMENT DUPLICATION TEST

Send identical verified successful Cashfree webhook 10 times.

Expected:

```text
Wallet credited once.
One payment credit ledger entry.
```

---

# 76. PROVIDER DUPLICATE TEST

Simulate provider accepting order but local request timing out.

Expected:

```text
RECONCILIATION_REQUIRED
```

No automatic second provider submission.

---

# 77. MIGRATION STRATEGY

Do not drop existing collections immediately.

Use additive migration.

Sequence:

### Migration 1
Add new money fields.

### Migration 2
Create WalletLedger.

New wallet operations use ledger.

Keep legacy transactions read-only.

### Migration 3
Create CatalogueService.

### Migration 4
Create Provider and ProviderOffer.

### Migration 5
Map existing Service records.

### Migration 6
New orders use CatalogueService.

### Migration 7
Backfill historical references where reliably possible.

### Migration 8
Deprecate legacy fields only after production verification.

Never fabricate historical financial data where source information is unavailable.

Mark migrated records with provenance.

---

# 78. LEGACY COMPATIBILITY

During migration provide compatibility layer.

Existing production customers must continue to:

- log in;
- see balance;
- see previous transactions;
- see previous orders.

Do not require all historical records to use new schema immediately.

---

# 79. DEPLOYMENT TARGET

Recommended:

## Frontend

Keep:

```text
Vercel
```

## API

Move toward always-running Node service such as:

```text
Railway
or
Render
```

## Worker

Separate continuously running worker service.

## Database

Keep:

```text
MongoDB Atlas
```

## Queue

Managed Redis.

Do not migrate database technology during this project unless a proven blocker emerges.

---

# 80. ENVIRONMENT STRUCTURE

Have separate:

```text
development
staging
production
```

Never test schema migrations directly on production first.

Cashfree:

```text
sandbox/staging
production
```

Provider integrations should support mock/sandbox adapters when provider does not offer sandbox.

---

# 81. REQUIRED DEVELOPMENT SCRIPTS

Codex should normalize scripts approximately to:

Frontend:

```text
npm run dev
npm run build
npm run lint
npm run test
```

Backend:

```text
npm run dev
npm start
npm run lint
npm run test
```

Worker:

```text
npm run worker
```

Exact commands should follow existing package manager and repository structure.

Do not replace package manager unnecessarily.

---

# 82. CI QUALITY GATE

Before merge:

```text
install
lint
backend tests
frontend tests
frontend production build
```

must pass.

Later add:

- dependency audit;
- integration tests;
- end-to-end smoke tests.

---

# 83. CODEX PHASE DELIVERY FORMAT

After each implementation task Codex must report:

```text
TASK COMPLETED

Files changed:
-

Models changed:
-

Indexes added:
-

Environment variables added:
-

Migration required:
-

Tests added:
-

Commands executed:
-

Tests passed:
-

Known limitations:
-

Recommended next task:
-
```

---

# 84. PHASE 0 DEFINITION OF DONE

Do not call Phase 0 complete until:

- every admin endpoint has server-side role authorization;
- browser cannot set order price;
- browser cannot order unassigned service;
- invalid quantities rejected;
- every order/refill/status operation checks ownership;
- wallet updates are atomic;
- wallet ledger exists;
- duplicate balance mutation protected;
- JWT fallback secret removed;
- frontend runtime defects repaired;
- related tests pass.

These are broadly the same Phase 0 exit conditions identified by the technical review.

---

# 85. PRICING PHASE DEFINITION OF DONE

Required demonstration:

Admin sets:

```text
X = 25%
```

Provider rate:

```text
₹100 / 1000
```

Customer sees:

```text
₹125 / 1000
```

Customer orders:

```text
5000 units
```

Backend calculates:

```text
₹625
```

Wallet debit:

```text
₹625
```

Order stores:

```text
provider cost rate = ₹100
markup = 25%
selling rate = ₹125
quantity = 5000
provider cost total = ₹500
customer total = ₹625
gross spread = ₹125
```

Changing markup later to 30% must not change historical order.

---

# 86. CASHFREE PHASE DEFINITION OF DONE

Demonstrate:

1. customer selects ₹1,000 top-up;
2. backend creates Payment;
3. backend creates Cashfree order;
4. frontend opens Cashfree checkout;
5. verified success received;
6. wallet receives exactly ₹1,000;
7. WalletLedger receives one credit;
8. duplicate webhook creates no duplicate credit;
9. frontend wallet refreshes;
10. admin sees payment;
11. failed payment does not credit;
12. manipulated frontend success does not credit;
13. reconciliation can recover missed webhook.

---

# 87. MULTI-PROVIDER PHASE DEFINITION OF DONE

Demonstrate one CatalogueService mapped to:

```text
Provider A Service 101
Provider B Service 889
```

Customer sees only:

```text
Instagram Followers Standard
```

Admin can choose Provider A as primary.

Order goes Provider A.

Provider IDs remain hidden from customer.

If Provider A response is ambiguous, order enters reconciliation rather than blindly going to Provider B.

---

# 88. PROJECT PRIORITY ORDER

Codex must implement in this sequence:

```text
0. Repository audit + documentation

1. Authentication/authorization security

2. Server-side order validation

3. Money minor-unit conversion strategy

4. Wallet ledger + atomic wallet service

5. Admin markup pricing engine

6. Existing frontend bug fixes

7. Automated tests + lint clean-up

8. CatalogueService architecture

9. Provider/ProviderOffer models

10. Existing provider adapter

11. Provider synchronization

12. Order state machine

13. Redis + BullMQ

14. Provider submission worker

15. Cashfree Payment model

16. Cashfree checkout

17. Cashfree webhook + wallet credit

18. Payment reconciliation

19. Refill workflow

20. Ticket system

21. Customer order timeline

22. Manual services

23. Second SMM provider

24. Manual priority routing

25. Drip-feed

26. Provider scoring

27. Automated routing

28. Analytics/optimization
```

---

# 89. DO NOT DO THESE THINGS

Codex must NOT:

- rewrite the entire project;
- migrate MongoDB to another database;
- redesign the whole frontend before fixing backend;
- trust frontend price;
- use floating-point rupees for ledger accounting;
- directly mutate wallet from controllers;
- delete ledger history;
- expose provider credentials;
- expose Cashfree secret;
- credit wallet from browser success;
- blindly retry ambiguous provider orders;
- introduce automated provider routing before manual routing works;
- implement drip-feed before durable worker exists;
- delete old Service/Transaction collections before migration validation;
- make breaking API changes without updating frontend and tests;
- silently change historical order prices.

---

# 90. FIRST CODEX TASK

Do **not** begin by implementing Cashfree or multi-provider support.

Give Codex this first task:

```text
Inspect the complete repository without making application changes.

Read all repository instructions and identify the current frontend, backend,
models, authentication middleware, admin routes, user routes, order flow,
wallet flow, provider integration, service assignment flow, deployment
configuration and test/build/lint setup.

Compare the repository against the SMM Panel Master Implementation Plan.

Produce:

1. current architecture map;
2. exact file-level list of Phase 0 vulnerabilities;
3. exact routes missing admin authorization;
4. exact order fields currently accepted from frontend;
5. exact wallet mutation paths;
6. exact provider submission path;
7. existing MongoDB schemas and indexes;
8. backwards-compatible Phase 0 implementation plan;
9. files that will be modified;
10. tests that will be added.

Do not change application code yet.

Create/update:
docs/architecture/current-state.md
docs/exec-plans/phase-0.md

Run the existing build, lint and tests and record baseline results.
```

---

# 91. SECOND CODEX TASK

After reviewing Task 1 output:

```text
Implement Phase 0 authorization and order validation only.

Do not implement payments, providers, queues or new UI.

Requirements:

- centralize authentication;
- create backend requireAdmin authorization;
- protect every privileged endpoint;
- constrain user roles;
- enforce order ownership;
- remove trust in browser-provided rate/total;
- validate assigned service and quantity server-side;
- add security tests;
- preserve existing API compatibility wherever safe;
- run lint/build/tests.

Report every modified file and any remaining Phase 0 risks.
```

---

# 92. THIRD CODEX TASK

```text
Implement the wallet ledger and money-handling foundation.

Requirements:

- represent new authoritative monetary values in integer paise;
- create WalletLedger;
- add unique idempotency keys;
- centralize wallet mutations in walletService;
- use MongoDB transactions where multiple documents must change atomically;
- use atomic balance increments;
- preserve existing historical transactions;
- migrate new activity first;
- add concurrency and idempotency tests;
- do not integrate Cashfree yet.
```

---

# 93. FOURTH CODEX TASK

```text
Implement the admin-controlled markup pricing engine.

Definition:

sellingRate =
providerCostRate × (1 + adminMarkupPercent / 100)

Store markup internally in basis points.

Requirements:

- PricingSettings with global markup;
- optional CatalogueService/service override compatible with current model;
- centralized pricingService;
- integer paise calculations;
- pricing snapshots;
- admin API to view/update markup;
- admin UI to change markup;
- audit markup changes;
- customer price determined only by backend;
- tests for multiple markup percentages and rounding.

Do not modify historical order prices.
```

---

# 94. FIFTH CODEX TASK

After Phase 0 + wallet + pricing pass:

```text
Introduce CatalogueService, Provider and ProviderOffer models alongside the
legacy Service model.

Wrap the existing SMM provider through a ProviderAdapter without changing
customer-facing behavior.

Backfill mappings safely.

Do not remove the legacy Service model yet.

Add provider synchronization in report-only/manual-trigger mode first.
```

---

# 95. SIXTH CODEX TASK

```text
Introduce Redis/BullMQ and a dedicated background worker.

Move provider order submission and provider synchronization into durable,
idempotent jobs.

Implement explicit reconciliation state for ambiguous provider results.

Do not implement automatic provider failover yet.
```

---

# 96. SEVENTH CODEX TASK

```text
Integrate Cashfree wallet top-ups using the existing merchant account.

Use current official Cashfree APIs/SDKs.

Implement:

Payment model
server-side Cashfree Create Order
frontend checkout
return-state UX
verified webhook
idempotent wallet credit
payment history
admin payment view
reconciliation worker

Never credit wallet based on frontend payment-success state.

Run all duplicate webhook, invalid signature and reconciliation tests before
enabling production credentials.
```

---

# 97. FINAL TARGET

The completed platform should behave as:

```text
CUSTOMER
   |
   v
STABLE SERVICE CATALOGUE
   |
   v
SERVER PRICING ENGINE
   |
   +--> Provider Cost
   |
   +--> Admin Markup X%
   |
   v
FINAL CUSTOMER PRICE
   |
   v
SECURE ORDER ENGINE
   |
   +--> WALLET LEDGER
   |
   +--> CASHFREE TOP-UP
   |
   v
DURABLE JOB QUEUE
   |
   v
FULFILMENT ROUTER
   |
   +--> PROVIDER A
   +--> PROVIDER B
   +--> MANUAL SERVICE
   |
   v
ORDER EVENTS
   |
   +--> STATUS
   +--> REFILLS
   +--> TICKETS
   +--> DRIP FEED
   +--> REFUNDS
```

The objective is not merely to make the current panel "work."

The objective is to ensure:

```text
one customer payment
=
one wallet credit

one customer order
=
one wallet debit

one fulfilment decision
=
one intended provider submission

provider price × admin markup
=
server-controlled selling price

every financial event
=
auditable immutable history
```

That is the production architecture to implement.