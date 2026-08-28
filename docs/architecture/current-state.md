# SMM Panel Current-State Architecture

Audit date: 28 August 2026  
Repository commit: `03401a6` (`main`, tracking `origin/main`)  
Scope: read-only repository audit for Master Implementation Plan Task 1. No application source was changed.

## Executive summary

The repository is a compact React/Vite frontend and Express/Mongoose backend deployed as separate Vercel projects. It supports login, role-aware frontend navigation, user and service administration, wallet balance changes, assigned-service ordering, transaction history, provider order status, and refills.

It is not safe for public financial use in its current state. Every admin route relies on a JWT role claim rather than reloading the current user, seven admin controllers have no role check at all, and the wallet adjustment check does not return after rejecting a non-admin. Order placement trusts browser-supplied service identifiers, rate, total, quantity, target, and refill data. Status and refill operations do not verify order ownership. Provider submission occurs inside a MongoDB transaction, so an external order can succeed even if local persistence later rolls back.

## Repository and runtime map

```text
frontend/ (React 19, Vite 6, React Router 7)
  src/App.jsx
    -> AuthProvider
    -> public login/unauthorized routes
    -> frontend-only role-gated admin and user routes
  src/context/Authcontext.jsx
    -> GET /api/auth/me on mount
    -> in-memory user and wallet state
  src/service/api.js
    -> Axios wrapper
    -> hardcoded https://backend.getfame.social/api
  src/components and src/pages
    -> admin user/service/balance screens
    -> customer order/history/profile screens

backend/ (Express 5, Mongoose 8)
  index.js
    -> CORS and cookie parsing
    -> MongoDB connection on every request
    -> /api/admin (JWT validation at mount)
    -> /api/user
    -> /api/auth
    -> exports Express app; it does not call app.listen()
  api/index.js
    -> Vercel serverless adapter
  middelwares/validate.js
    -> verifies auth_token cookie
    -> copies decoded JWT to req.user
    -> aliases req.body as req.payload
  controllers/
    -> authController: login, current user, logout
    -> adminController: users, balances, assignments, services
    -> userController: password, catalogue, wallet history, orders, provider status/refills
  models/
    -> User, Service, Order, Transaction
  utils/serverlessDb.js
    -> cached Mongoose connection used by the app

MongoDB Atlas / MongoDB
  -> users
  -> services
  -> orders
  -> transactions

External SMM provider
  -> API_URL + API_KEY
  -> service discovery, add order, order status, refill, refill status
```

There is no Redis instance, durable queue, worker process, payment gateway integration, stable catalogue/provider separation, immutable wallet ledger, audit log, or automated test suite.

## Frontend routes and access

`frontend/src/App.jsx` declares:

- Public: `/login`, `/unauthorized`, `/home`, `/`.
- Frontend `admin` gate: `/addPayment`, `/services`, `/changeUserPassword`, `/userDashboard`.
- Frontend `user` gate: `/payments`, `/orders`, `/profile`.

`/home` and `/` perform their own authentication redirect and then render either the customer order form or admin create-user form. `ProtectedRoute` is useful UX but is not a backend authorization boundary.

## Authentication flow

1. `POST /api/auth/login` finds the user by normalized/case-insensitive user ID and compares the bcrypt hash.
2. The backend signs `{ id: user.userId, role: user.role }` for one hour.
3. The token is stored as `auth_token`, with `httpOnly`, `secure`, and `sameSite: none`.
4. `validate` verifies the cookie and trusts the decoded token as `req.user`.
5. `GET /api/auth/me` reloads the user for profile data, but privileged admin requests do not centrally reload the current user or role.

Security findings:

- `authController.login` falls back to the literal secret `your_jwt_secret` if `JWT_SECRET` is missing.
- `validate` has no fallback, so login and verification can use different secrets when configuration is absent.
- Admin authorization is based on the JWT claim, allowing a previously issued admin token to remain privileged after a database role change until expiry.
- `User.role` is an unconstrained required string rather than a `user|admin` enum.
- Login has no rate limit, lockout, or audit trail.
- Cookie settings are fixed for cross-site production and are not environment-aware; there is no CSRF control beyond CORS.
- Password-changing endpoints return plaintext new passwords, and create-user returns the submitted plaintext password.

## Backend route authorization audit

All `/api/admin` routes are authenticated twice: once at the app mount and once in `adminRoutes.js`. Neither layer requires admin status or reloads the current user. Consequently, no admin route currently meets the master plan's authoritative authorization requirement.

| Method and route | Current controller check | Effective finding |
|---|---|---|
| `POST /api/admin/createUser` | Checks JWT `req.user.role`; returns 400 | Stale-token authorization only; returns plaintext password |
| `POST /api/admin/getUser` | None | Any authenticated user can inspect another user, orders, balance, transactions, and services |
| `PUT /api/admin/addBalance` | Checks JWT role but does not `return` after responding | Any authenticated user can continue into wallet mutation; may also trigger headers-already-sent behavior |
| `POST /api/admin/changeUserPassword` | Checks JWT `req.user.role`; returns 403 | Stale-token authorization only; returns plaintext new password |
| `POST /api/admin/createService` | Checks JWT `req.user.role`; returns 400 | Stale-token authorization only |
| `PUT /api/admin/updateService` | None | Any authenticated user can change min, max, rate, and refill |
| `POST /api/admin/addService` | None | Any authenticated user can assign services to any user |
| `POST /api/admin/deleteService` | None | Any authenticated user can remove assignments from any user |
| `GET /api/admin/getCustomServices` | None | Any authenticated user can enumerate internal services |
| `POST /api/admin/deleteCustomServices` | None | Any authenticated user can delete a service and remove it from all users |
| `GET /api/admin/getServices` | None | Any authenticated user can trigger provider service discovery |

The route named `/deleteService` removes a service assignment from a user; `/deleteCustomServices` deletes the actual `Service` document. There is no implemented create-user deletion/deactivation route despite the root README description.

## Service catalogue and assignment flow

The current `Service` model combines the customer catalogue and provider mapping:

- `serviceId`: local customer-facing identifier, unique string.
- `service`: provider service identifier, but ambiguously named.
- `internalName` and `name`: internal/display strings.
- `rate`: JavaScript `Number`, apparently rupees per 1,000.
- `min` and `max`: strings.
- `refill`: boolean.

The admin fetches provider services through `GET /api/admin/getServices`, creates a local `Service`, then adds its `serviceId` to `User.services`. Customer catalogue retrieval loads all services and filters in application memory using `User.services.includes(service.serviceId)`.

There is no active/availability flag. Provider IDs and internal service mapping are returned to the browser and displayed by the order form.

## Exact order request and pricing flow

The frontend order form sends:

```json
{
  "linkInput": "https://...",
  "serviceId": "local-service-id",
  "providerServiceId": "provider-id",
  "service": "provider-id",
  "quantity": 1000,
  "rate": 100,
  "totalAmount": 100,
  "refill": true
}
```

`userController.placeOrder` accepts exactly these browser-controlled values:

- destructured: `serviceId`, `service`, `providerServiceId`, `linkInput`, `quantity`, `rate`, `totalAmount`;
- separately read: `refill`.

It builds provider candidates in this order: `providerServiceId`, `service`, `serviceId`. It does not load the selected local `Service`, check that the service is assigned to the authenticated user, validate min/max, require an integer positive quantity, validate the target, or calculate price. It debits `totalAmount` and stores `rate` directly from the browser.

Material consequences include zero/negative/NaN totals, ordering an unassigned provider service, out-of-range or invalid quantity, false historical rates, and provider/internal identifier confusion. A negative `totalAmount` makes `$inc: { money: -totalAmount }` a wallet credit.

## Wallet and transaction mutation paths

### Admin credit: `PUT /api/admin/addBalance`

1. Reads `userId` and `amount` from the browser without numeric/positive validation.
2. Loads the user and calculates `curr.money + amount` in JavaScript.
3. Executes a `User.updateOne(...$set...)` outside a transaction.
4. Starts a MongoDB transaction and repeats the same `$set` using the stale value.
5. Creates a `Transaction` with a random UUID in `orderId`.

The first write can survive when ledger/history creation fails. Concurrent adjustments can overwrite each other. A string amount can cause coercion/concatenation. There is no idempotency key, reason, direction, actor, or immutable ledger guarantee.

### Order debit: `POST /api/user/placeOrder`

1. Reads the user balance within a session.
2. Compares it to browser-supplied `totalAmount`.
3. Performs `$inc: { money: -totalAmount }` within the transaction, but without a balance predicate.
4. Calls the external provider while the transaction remains open.
5. Creates the local `Order` and negative `Transaction` if later steps succeed.

Although `$inc` is preferable to read-then-set, the debit is not centralized, price is untrusted, provider side effects cannot roll back, and there is no idempotency protection. `User.money`, `Service.rate`, `Order.rate`, and `Transaction.amount` are floating-point major-unit numbers.

No other backend wallet mutation path was found.

## Provider integration and submission path

Provider configuration is read directly from `API_URL` and `API_KEY` environment variables.

- Service discovery: admin controller posts URL-encoded `key` and `action=services`.
- Submission: user controller loops over up to three browser-supplied candidate service IDs and sends `action=add`, service, link, and quantity as query parameters.
- Immediate status: after acceptance it sends `action=status` and the provider order ID as query parameters.
- Customer status refresh: posts a JSON body containing key, action, and order; this differs from the other provider request shapes.
- Refill: posts query parameters with `action=refill`.
- Refill status: sends a GET with `action=refill_status` and treats the request's `orderId` field as a provider refill ID.

Provider calls are made synchronously from request controllers. Submission happens inside a MongoDB transaction. If the provider accepts but the response is lost, the loop may try another candidate. If the provider accepts and local status/order/transaction work fails, MongoDB rolls back but the real provider order remains. There is no timeout classification, reconciliation state, submission idempotency, normalized adapter, durable retry, or job queue.

## Ownership audit

- `GET /api/user/getOrders` and `GET /api/user/getTransactions` correctly derive the MongoDB user from the authenticated token and query by its ObjectId.
- `POST /api/user/getOrderStatus` calls the provider, then updates by `{ orderId }` only. It does not require the local order to belong to the authenticated user.
- `POST /api/user/requestRefill` calls the provider and updates by `{ orderId }` only. It does not verify ownership or refill eligibility before the side effect.
- `POST /api/user/requestRefillStatus` never loads a local order and does not verify ownership.
- `POST /api/user/placeOrder` uses the authenticated user for the wallet/order owner but does not verify the submitted service assignment.

## Existing MongoDB schemas and indexes

### User

Fields: `userId` (required, unique, trimmed, lowercase string), `password` (required string), `money` (number, default 0), `role` (required unconstrained string), `services` (string array). No timestamps.

Indexes:

- unique `userId` index generated by `unique: true`;
- explicit `{ userId: 1 }`, redundantly declaring the same key.

### Service

Fields: `serviceId` (required unique string), `service`, `internalName`, `name` (required strings), `rate` (required number), `min`, `max` (required strings), `refill` (boolean, default false). No timestamps.

Index: unique `serviceId` generated by `unique: true`.

### Order

Fields: `orderId` (required unique string), `lastStatus` (required string), `quantity` and `rate` (required numbers), `service` (required string), `user` (required `User` ObjectId), `refill` (nullable string), `start_count` (string), timestamps.

Indexes:

- unique `orderId` generated by `unique: true`;
- explicit `{ orderId: 1 }`, redundantly declaring the same key;
- `{ user: 1 }`;
- `{ user: 1, createdAt: -1 }`.

### Transaction

Fields: `amount` (required number), `orderId` (required unique string), `date` (default current date), `user` (required `User` ObjectId).

Indexes:

- unique `orderId` generated by `unique: true`;
- `{ user: 1 }`;
- `{ user: 1, date: -1 }`.

There are no explicit status/date/provider indexes, partial indexes, ledger idempotency index, migrations, or migration runner.

## Frontend defects relevant to Phase 0

- `frontend/src/pages/user/UserProfilePage.jsx` calls `serviceApi.changePassword` without importing `serviceApi`; ESLint reports `no-undef`.
- `frontend/src/components/OrderForm.jsx` declares `loadingToastId` inside `try` but references it in `catch`; unexpected failures can throw `ReferenceError` while handling the original error.
- `frontend/src/cards/TransactionCard.jsx` hardcodes every transaction to `completed`.
- Auth context wallet state is populated at login or initial `/me` only and is not refreshed after an order or admin adjustment.
- `serviceApi.placeOrder` returns `response.data.data`, but the backend success response has no `data` property.
- Orders and payments pages pass `{ page, limit }` as the first argument to API functions that accept `(page, limit)`, while the backend reads `page[page]` and `page[limit]`; pagination contracts do not align.
- API helpers usually convert Axios failures into `{ success: false }`, while several components expect thrown errors or nested response shapes. This produces misleading empty states and error handling.
- The API base URL is hardcoded to production.

## Deployment and configuration

- Frontend: `frontend/vercel.json` rewrites all paths to `index.html` for SPA routing.
- Backend: `backend/vercel.json` sends all methods/paths to `api/index.js`.
- Root: `vercel-dont-use.json` is an older combined deployment definition and is explicitly named not to use.
- The frontend tracks generated `dist` artifacts even though root `.gitignore` ignores `dist`.
- Backend required variables are `MONGO_URI`, `JWT_SECRET`, `API_URL`, and `API_KEY`; `PORT` and `NODE_ENV` are documented as optional.
- The frontend has no environment variable for API base URL.
- `backend/index.js` only exports the app, so the documented local `npm start` command does not start an HTTP listener.

## Baseline quality gates

Commands were executed against the existing installed dependencies on 28 August 2026.

| Check | Command | Result |
|---|---|---|
| Frontend production build | `cd frontend; npm run build` | Passed: 1,717 modules; CSS 48.72 kB, JS 422.55 kB. Warned that Browserslist data is 15 months old. Generated `dist` was restored to its tracked baseline after the check. |
| Frontend configured lint script | `cd frontend; npm run lint` | Failed: script does not exist. |
| Frontend direct ESLint baseline | `cd frontend; npx eslint .` | Failed: 21 errors and 6 warnings across application/config files. |
| Frontend tests | `cd frontend; npm test` | Failed: script does not exist; no test files/framework found. |
| Backend tests | `cd backend; npm test` | Failed intentionally: placeholder prints `Error: no test specified`. |
| Backend lint | `cd backend; npm run lint` | Failed: script does not exist; no ESLint configuration found. |
| Backend syntax | `node --check` for all backend `.js` files | Passed for all 17 files. |

## Phase 0 file-level vulnerability register

| Severity | File(s) | Finding |
|---|---|---|
| P0 | `backend/middelwares/validate.js`, `backend/index.js`, `backend/routes/adminRoutes.js` | Authentication and admin authorization are conflated; no current-user admin middleware exists. |
| P0 | `backend/controllers/adminController.js` | Missing/ineffective privilege checks, plaintext password responses, unsafe two-stage wallet update, no amount/idempotency validation. |
| P0 | `backend/controllers/userController.js` | Browser-controlled price/service data, missing assignment and quantity validation, missing ownership checks, provider side effect inside transaction. |
| P0 | `backend/controllers/authController.js` | Fallback JWT secret and fixed production cookie policy. |
| P0 | `backend/models/User.js` | Unconstrained role and floating-point cached balance. |
| P0 | `backend/models/Service.js` | Provider/customer concepts combined; floating-point rate; string min/max; no active/availability state. |
| P0 | `backend/models/Order.js` | Browser rate stored as history; no authoritative price snapshot or local/provider ID separation. |
| P0 | `backend/models/Transaction.js` | Mutable, underspecified history with no type, direction, before/after balance, actor, source, or idempotency key. |
| P1 | `frontend/src/components/OrderForm.jsx` | Sends authoritative-looking price/provider fields and has out-of-scope toast ID. |
| P1 | `frontend/src/pages/user/UserProfilePage.jsx` | Missing `serviceApi` import causes runtime failure. |
| P1 | `frontend/src/cards/TransactionCard.jsx` | Misrepresents every transaction as completed. |
| P1 | `frontend/src/context/Authcontext.jsx`, `frontend/src/service/api.js` | Stale wallet state, hardcoded production URL, and inconsistent response handling. |

The backwards-compatible implementation sequence, affected files, migrations, and planned tests are specified in `docs/exec-plans/phase-0.md`.
