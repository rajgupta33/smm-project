# SMM Panel Repository Instructions

- Frontend: `frontend/` (React 19 + Vite). Run `npm run dev`, `npm run build`, `npm run lint`, and `npm test` from that directory when the scripts exist.
- Backend: `backend/` (Express + MongoDB/Mongoose). Run `npm run dev`, `npm start`, `npm run lint`, and `npm test` from that directory.
- Use the existing npm lockfiles. Do not replace the package manager without approval.
- Configuration belongs in environment variables and documented example files. Never commit secrets or use fallback production secrets.
- Privileged API routes require backend authentication and authorization using the current database user. Frontend route guards are not a security boundary.
- Never trust browser-supplied prices, totals, provider identifiers, wallet values, or roles. Authoritative pricing and eligibility are calculated on the backend.
- Store new authoritative money in integer paise. Wallet mutations must use the immutable ledger and centralized wallet service once introduced.
- Provider IDs are internal fulfilment identifiers, not customer-facing catalogue service IDs.
- A provider timeout is ambiguous. Never blindly retry or submit to another provider until reconciliation proves the original request was not accepted.
- Cashfree wallet credits may occur only after verified server-side confirmation and must be idempotent.
- Background jobs must be durable and idempotent, with database uniqueness protecting against duplicate execution.
- Database changes must be additive and preserve historical orders, transactions, and legacy customer access until migrations are verified.
- Keep changes phase-scoped. Update tests and run lint, frontend build, and relevant tests before completing each task.
