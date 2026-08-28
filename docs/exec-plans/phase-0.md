# Phase 0 Execution Plan

Status: Phase 0 implementation complete  
Prepared: 28 August 2026  
Source of truth: `SMM PANEL — MASTER IMPLEMENTATION PLAN FOR CODEX.md` and `docs/architecture/current-state.md`

## Implementation progress — 28 August 2026

Completed in the first implementation slice:

- Added repository instructions and a backend Node test/ESLint harness.
- Added database-backed `authenticate` and `requireAdmin` middleware.
- Protected all 11 existing `/api/admin/*` endpoints at the router mount.
- Removed the JWT role claim from newly issued tokens and removed the fallback JWT secret.
- Constrained `User.role` to `user|admin` and removed plaintext passwords from admin create/reset responses.
- Made order validation load the assigned local service and use its provider mapping and rate.
- Ignored browser-supplied price, total, provider service, and refill authority.
- Added positive-integer, min/max, and HTTP(S) target validation.
- Added ownership checks before order-status, refill, and refill-status provider calls.
- Changed the frontend order payload to service ID, target, and quantity only.
- Fixed the order-form loading-toast scope defect encountered in the changed path.
- Added 17 passing backend security/unit tests.

Completed in the pricing slice:

- Added versioned singleton pricing settings, basis-point global markup, minimum margin, and service overrides.
- Added integer-paise upward-rounded pricing and immutable new-order price snapshots.
- Added optimistic admin updates, transactional audit history, server-side preview, and an admin pricing page.
- Changed customer catalogue prices and wallet debits to use authoritative selling rates without exposing provider costs.
- Added pricing rollout/product documentation and representative rounding, override, limit, and historical-snapshot tests.

Completed in the provider-containment slice:

- Committed the wallet debit and durable order intent before any provider request.
- Added a single atomic submission claim and stable public order identifiers.
- Added a provider adapter with bounded timeouts, sanitized response evidence, and explicit accepted/rejected/ambiguous classification.
- Added idempotent refunds for definitive rejection and reconciliation states for timeouts, transport errors, malformed responses, provider 5xx, and acceptance-persistence failures.
- Prevented automatic retries and disabled customer provider actions until acceptance is confirmed.
- Added provider contract, lifecycle, migration, and failure-matrix tests.

Still pending in Phase 0:

- Production-like staging validation, index rollout, and operational reconciliation ownership before deployment.

Completed in the configuration/frontend-hardening slice:

- Added fail-fast validation for database, JWT, provider, origin, and cookie configuration.
- Added environment-aware cookies, strict CORS allowlisting, double-submit CSRF protection, login throttling, and authentication audit records.
- Moved the frontend API base URL to `VITE_API_BASE_URL` with a local-development default and centralized CSRF handling.
- Fixed profile password submission, plaintext password responses, authoritative wallet refresh, pagination behavior, provider-error leakage, and stale/dead frontend code.
- Added Vitest/React Testing Library, frontend regression tests, and cleared all frontend/backend lint findings.
- Updated non-breaking dependencies; production dependency audits now report zero known vulnerabilities.

Completed in the wallet foundation slice:

- Added authoritative `User.walletBalanceMinor` and provenance for legacy-balance migration.
- Added immutable `WalletLedger` with unique idempotency keys and statement/source indexes.
- Added a centralized transactional wallet service for credit, debit, refund, and admin adjustment.
- Converted new order debits and admin adjustments to integer paise ledger mutations.
- Added conditional debit protection, order/admin idempotency headers, and an order idempotency index.
- Kept `User.money` as a transactionally updated compatibility mirror and kept legacy `Transaction` records read-only.
- Merged new ledger entries with legacy transaction history for customer reads.
- Added a dry-run-by-default wallet balance migration and deployment runbook.
- Added wallet concurrency, duplicate replay, conflict, integer validation, lazy migration, and index tests.

## Objective and boundaries

Stabilize authorization, order validation, wallet accounting, server-side pricing, ownership, authentication configuration, and known frontend runtime defects without rewriting the application or removing legacy collections.

Phase 0 will be delivered as small reviewable tasks. Each task must update/add tests, run frontend lint/build/tests and backend lint/tests, report schema/index/environment changes, and stop before the next task.

Out of scope for Phase 0: Cashfree, Redis/BullMQ, background workers, a second provider, automatic provider routing, drip-feed, tickets, and a broad frontend redesign.

## Compatibility strategy

- Keep current `/api/auth`, `/api/admin`, and `/api/user` route paths during stabilization.
- Keep legacy `User.money`, `Service`, `Order.rate`, and `Transaction` fields readable while additive minor-unit fields and ledger records are introduced.
- Continue returning the fields used by existing screens, but remove plaintext passwords and stop accepting browser financial authority.
- Add new collections and fields before backfilling. Do not delete or fabricate historical records.
- Treat `Transaction` as legacy read-only history once new mutations use `WalletLedger`; merge old and new activity at the read boundary until the UI is migrated.
- Preserve historical order values exactly. New authoritative snapshots apply only to new orders.
- Wrap the current provider request format before changing provider architecture; Phase 0 must first prevent ambiguous retries and cross-user operations.

## Task 0A — Test and configuration harness

Purpose: create a repeatable safety net before changing privileged and financial paths.

Implementation:

1. Split the Express app export from a local server bootstrap so integration tests can import the app without listening and `npm start` can actually serve locally.
2. Add backend test tooling using the repository's CommonJS conventions, with a disposable MongoDB test database or transaction-capable test replica set.
3. Add frontend Vitest + React Testing Library using the existing Vite configuration.
4. Add `lint` and `test` scripts to both packages and make test environment variables explicit.
5. Add provider HTTP mocking; tests must never call the real provider.

Likely files:

- Modify `backend/index.js`, `backend/package.json`, `backend/package-lock.json`.
- Add `backend/server.js`, backend test setup/helpers, and initial smoke tests.
- Modify `frontend/package.json`, `frontend/package-lock.json`, `frontend/vite.config.js`.
- Add frontend test setup.
- Add or update environment examples for test-safe configuration.

Acceptance:

- Existing frontend build still passes.
- Both packages expose working `lint` and `test` scripts.
- Tests can import the Express app without opening a production port or contacting MongoDB/provider unintentionally.

## Task 0B — Central authentication and authoritative admin authorization

Purpose: ensure every privileged operation is rejected for ordinary users and revoked admins.

Implementation:

1. Replace the current `validate` responsibility with `authenticate` that verifies the cookie, validates the token subject, loads the current user from MongoDB, and attaches a minimal current-user object.
2. Add `requireAdmin`, which checks the current database role and returns 403.
3. Mount `authenticate` then `requireAdmin` once for all `/api/admin` routes; remove duplicate route-level `validate` declarations and controller role checks.
4. Constrain `User.role` to `user|admin` with an enum and safe default/validation behavior for existing documents.
5. Remove plaintext passwords from create/reset responses.
6. Ensure an unauthorized request returns before any controller mutation.

Files expected to change:

- `backend/index.js`
- `backend/routes/adminRoutes.js`
- `backend/routes/authRoutes.js`
- `backend/routes/userRoutes.js`
- `backend/middelwares/validate.js` (compatibility export during migration) or a new correctly named middleware module
- `backend/controllers/adminController.js`
- `backend/controllers/authController.js`
- `backend/models/User.js`
- backend authorization/authentication tests

Tests:

- Missing, invalid, and expired cookie return 401.
- Normal user receives 403 for every one of the 11 current `/api/admin/*` endpoints.
- No database/provider mutation occurs on each 403.
- A token issued while the user was admin is rejected after the database role becomes `user`.
- Invalid roles cannot be created or persisted.
- Create/reset responses never contain a password.

Migration/index impact:

- Add schema enum only; do not rewrite existing users automatically.
- Before deploying validation, run a read-only role audit. Any value outside `user|admin` requires an explicit remediation record.
- Retain the existing unique `userId` index and remove only redundant schema index declaration after comparing live indexes.

## Task 0C — Server-side order validation and ownership

Purpose: make the backend the sole authority for service eligibility, quantity, target, and price inputs.

Implementation:

1. Define a strict order request schema. Transitional request compatibility may accept legacy `serviceId`, but `rate`, `totalAmount`, `providerServiceId`, `service`, and `refill` must be rejected as unknown financial/provider authority or explicitly ignored and never used.
2. Load the authenticated user and local `Service` by `serviceId`.
3. Verify `serviceId` is present in `User.services`.
4. Parse legacy string `min/max` safely; require finite positive integer quantity within the service limits.
5. Validate and normalize the target. Initially permit only configured `http:`/`https:` URLs, with future service-specific target schemas.
6. Calculate the authoritative charge from the database service rate using a single temporary pricing function until the formal minor-unit pricing service lands in Task 0E.
7. Query status/refill records by both local order identifier and authenticated `user` before any provider call.
8. For refill status, resolve the owned local order and stored refill ID rather than trusting an arbitrary provider refill ID.
9. Correct the current Mongoose `findOneAndUpdate` result handling in order status.

Files expected to change:

- `backend/controllers/userController.js`
- `backend/routes/userRoutes.js`
- `backend/models/Service.js` (validation additions only if compatible)
- `backend/models/Order.js` (additive local/pricing fields as required)
- a new request schema/validation module
- a temporary or final pricing-domain module
- `frontend/src/components/OrderForm.jsx`
- `frontend/src/service/api.js`
- order/ownership integration tests and frontend order-form tests

Tests:

- The explicit manipulation payload `{ serviceId, quantity: 10000, rate: 0, totalAmount: -100000 }` cannot alter the server-calculated charge.
- Zero, negative, decimal, NaN-like, infinite-like, below-min, and above-max quantities fail.
- Unassigned, unknown, inactive/unavailable (once field exists), and malformed-target orders fail before provider/wallet calls.
- Customer A cannot query status, request refill, or query refill status for Customer B's order.
- Provider/internal identifiers from the browser are ignored/rejected.
- Existing valid assigned-service requests still succeed through the compatibility `serviceId` field.

Known temporary limitation:

- Until Task 0F moves submission to a durable workflow, an accepted provider call can still be ambiguous. Task 0C must at minimum remove multi-candidate submission and prevent automatic blind retries.

## Task 0D — Minor-unit wallet ledger and atomic wallet service

Purpose: guarantee that each authorized wallet event has exactly one auditable entry and atomic cached-balance change.

Implementation:

1. Add `walletBalanceMinor` to `User` without deleting `money`.
2. Create immutable `WalletLedger` with direction/type, `amountMinor`, currency, before/after balances, source, idempotency key, actor, description, and timestamps.
3. Add a unique `idempotencyKey` index and query indexes for statements and reconciliation.
4. Create `walletService` methods for credit, debit, refund/reversal, and admin adjustment.
5. Each mutation must run the conditional balance update and ledger insert in one MongoDB transaction. Debit uses a predicate requiring sufficient balance.
6. Remove all direct wallet mutation logic from controllers.
7. Require admin adjustment direction, positive integer paise amount, reason, and idempotency key.
8. Keep legacy `Transaction` documents unchanged and readable. New wallet activity writes ledger first; a compatibility projection may feed the existing history UI.

Files expected to change/add:

- `backend/models/User.js`
- new `backend/models/WalletLedger.js`
- new `backend/services/walletService.js`
- `backend/controllers/adminController.js`
- `backend/controllers/userController.js`
- `backend/models/Transaction.js` only for explicit legacy documentation/guards if needed
- wallet unit/integration/concurrency tests
- additive migration/backfill script and runbook
- `backend/env.example` if transaction-test/database configuration is added

Indexes:

- `WalletLedger.idempotencyKey` unique.
- `{ userId: 1, createdAt: -1 }`.
- `{ sourceType: 1, sourceId: 1 }`.
- Consider a unique compound source index only after legacy/source cardinality is proven.

Migration:

1. Inventory non-integer/negative/invalid legacy balances.
2. Backfill `walletBalanceMinor = round(money * 100)` only where the source is unambiguous, recording provenance and counts.
3. Do not create fabricated historical ledger entries. Use an explicit opening-balance entry only if product/accounting owners approve it.
4. During a controlled compatibility window, compare minor-unit and legacy read values; authoritative new writes must not independently mutate both without a single tested adapter.

Tests:

- Credit/debit/refund/admin adjustment success and rollback.
- Duplicate idempotency key changes balance once.
- Two simultaneous ₹700 orders against ₹1,000 allow exactly one debit; final balance is ₹300 with one debit entry.
- Insufficient funds never calls provider.
- Controller code cannot directly update wallet fields.
- Transaction failure leaves neither balance nor ledger partially changed.

## Task 0E — Admin markup and authoritative pricing snapshots

Purpose: implement integer-paise server pricing with admin markup in basis points and immutable order history.

Implementation:

1. Create singleton/versioned `PricingSettings` with global markup BPS, INR, pricing unit 1,000, minimum margin, updater, and version.
2. Add optional `markupOverrideBps` to the current `Service` as a compatibility bridge until `CatalogueService` is introduced.
3. Create `pricingService` with integer-safe upward rounding for provider rate, selling rate, totals, and price snapshots.
4. Store an immutable snapshot on each new `Order`.
5. Add admin-only read/update endpoints with validation, configurable maximum, optimistic versioning, and audit record.
6. Add a small admin pricing page and server-provided preview. Customer order form displays a server-derived rate/quote and submits only service ID, target, and quantity. Submission recalculates.

Files expected to change/add:

- new `backend/models/PricingSettings.js`
- new `backend/models/AuditLog.js`
- new `backend/services/pricingService.js`
- `backend/models/Service.js`
- `backend/models/Order.js`
- pricing/admin controllers and routes
- `frontend/src/App.jsx`, `frontend/src/service/api.js`, `frontend/src/components/OrderForm.jsx`
- new admin pricing page/component
- pricing unit/integration/frontend tests

Indexes:

- Unique singleton/settings key or equivalent enforced configuration identity.
- Audit log indexes on `{ action: 1, createdAt: -1 }` and `{ actorId: 1, createdAt: -1 }` after query review.

Tests:

- Markups 0%, 1%, 10%, 25%, 37.5%, and 100%; tiny/odd paise rates and large quantities.
- Service override takes precedence over global setting.
- ₹100/1,000 at 25% becomes ₹125/1,000; quantity 5,000 charges ₹625.
- Later markup changes do not alter an existing order snapshot.
- Normal users cannot read internal provider cost or update pricing.
- Negative, non-finite, malformed, and above-configured-limit markup fails.

## Task 0F — Provider side-effect containment

Purpose: prevent known duplicate fulfilment while preserving the current single provider.

Implementation:

1. Stop trying multiple browser-derived service candidates. Use only the provider ID loaded from the authorized local service.
2. Commit an order intent and fund reservation/debit before provider submission using an explicit local status.
3. Record submission attempt state and provider response snapshots.
4. Classify definitive rejection separately from timeout/transport ambiguity.
5. On ambiguous result, mark `RECONCILIATION_REQUIRED`; do not resubmit automatically and do not try a fallback provider.
6. Keep the HTTP request-driven submission temporarily if queue infrastructure is deferred, but design the state transition and idempotency key for later worker extraction.

Files expected to change/add:

- `backend/controllers/userController.js`
- `backend/models/Order.js`
- a new provider client/adapter boundary for the current provider
- order event/audit support if introduced in this slice
- provider contract and failure-classification tests

Tests:

- Accepted, rejected, malformed response, unavailable provider, and timeout.
- Simulated provider acceptance followed by lost response produces `RECONCILIATION_REQUIRED` and no second submission.
- Local persistence failure cannot silently cause an automatic duplicate call.

## Task 0G — JWT/configuration hardening and frontend defects

Purpose: close remaining Phase 0 configuration risks and restore reliable user feedback.

Backend implementation:

- Validate `MONGO_URI`, `JWT_SECRET`, `API_URL`, and `API_KEY` at startup with no fallback secret.
- Add environment-aware cookie configuration and documented allowed origins.
- Add login rate limiting and security audit records.
- Select and implement CSRF protection appropriate to the deployed same-site/cross-site domain model.
- Prevent stack/provider-secret leakage in customer responses.

Frontend implementation:

- Import `serviceApi` in `UserProfilePage` and cover password submission.
- Keep the order loading-toast ID in handler scope and cover failure behavior.
- Normalize API success/error handling and pagination parameter shape.
- Refresh authenticated wallet state after authoritative wallet mutation.
- Stop hardcoding transaction status as completed; derive an honest legacy label until typed ledger entries are live.
- Move API base URL to `VITE_API_BASE_URL` with a safe local default or explicit configuration failure policy.
- Remove current lint errors and address warnings without unrelated visual refactors.

Files expected to change:

- `backend/controllers/authController.js`
- authentication/config/error/audit middleware/services
- `backend/env.example`
- `frontend/src/pages/user/UserProfilePage.jsx`
- `frontend/src/components/OrderForm.jsx`
- `frontend/src/cards/TransactionCard.jsx`
- `frontend/src/context/Authcontext.jsx`
- `frontend/src/service/api.js`
- lint-identified frontend files where changes are mechanical and verified
- relevant backend/frontend tests

Environment variables expected by the end of Phase 0:

- Existing required: `MONGO_URI`, `JWT_SECRET`, `API_URL`, `API_KEY`.
- Existing runtime: `NODE_ENV`, `PORT`.
- Planned: `ALLOWED_ORIGINS`, cookie domain/same-site/secure settings if deployment needs explicit overrides, `VITE_API_BASE_URL`, and configurable markup maximum. Exact names must be finalized once deployment topology is confirmed; secrets never receive source defaults.

## Planned test matrix

### Authorization

- One parameterized integration test enumerating every `/api/admin/*` method/path for normal-user 403 and zero side effects.
- Admin success controls for each operation.
- Role revocation with an old token.

### Order security and ownership

- Manipulated financial fields.
- Assigned/unassigned service matrix.
- Quantity and target validation boundaries.
- Cross-account status/refill/refill-status attempts.
- Provider timeout/ambiguous result and no duplicate request.

### Wallet and pricing

- Atomic credit/debit, rollback, idempotency, concurrency, reversal, and legacy-read compatibility.
- Markup/rounding/override/snapshot tests, including the 25% definition-of-done example.

### Authentication/frontend

- Missing secret/startup validation, cookie behavior, login throttling, and revoked role.
- Profile password action, order error toast, wallet refresh, pagination, and transaction label.

## Release and migration gates

1. Run read-only production data audits for roles, service min/max values, rates, balances, and duplicate/invalid identifiers.
2. Test additive migrations on a production-like staging snapshot, never directly on production first.
3. Require a MongoDB deployment that supports transactions for wallet/order integration tests and production.
4. Create indexes in a controlled deployment and inspect duplicate conflicts before enabling unique constraints.
5. Deploy authorization before exposing new financial functionality.
6. Deploy new-money writes behind a compatibility flag if needed; reconcile before declaring them authoritative.
7. Keep legacy collections until production verification and rollback windows complete.

## Definition of done

Phase 0 is complete only when:

- Every admin endpoint performs current-database role authorization and normal users receive 403 without mutation.
- Browser-supplied rates/totals/provider IDs cannot affect price, wallet, or fulfilment.
- Only assigned services and valid integer quantities/targets can be ordered.
- All customer order status and refill operations verify ownership before provider calls.
- New authoritative money uses integer paise and every mutation atomically writes one immutable, idempotent ledger entry.
- Concurrent debits cannot overdraw the wallet.
- Orders store immutable server-generated price snapshots.
- Missing required secrets fail startup; password responses do not expose plaintext.
- Ambiguous provider submission never triggers blind resubmission.
- Known frontend runtime defects are covered by tests and wallet state refreshes correctly.
- Frontend and backend lint, tests, and the frontend production build all pass.

## Files planned for the first implementation slice

The next approved task should be Task 0A plus Task 0B/0C only: test harness, centralized authorization, strict server-side order validation, and ownership. It must not add Cashfree, queues, new providers, or the pricing UI.

Minimum anticipated application files:

- `backend/index.js`
- `backend/routes/adminRoutes.js`
- `backend/routes/authRoutes.js`
- `backend/routes/userRoutes.js`
- authentication/authorization middleware
- `backend/controllers/adminController.js`
- `backend/controllers/authController.js`
- `backend/controllers/userController.js`
- `backend/models/User.js`
- `backend/models/Service.js`
- `backend/models/Order.js`
- `frontend/src/components/OrderForm.jsx`
- `frontend/src/service/api.js`
- package manifests/lockfiles and new tests/setup

Review checkpoint: approve this audit and first-slice file scope before application changes begin.
