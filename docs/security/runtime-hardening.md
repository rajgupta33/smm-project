# Runtime and browser security

## Required backend configuration

Startup now fails before serving requests unless `MONGO_URI`, a JWT secret of at least 32 characters, `API_URL`, and `API_KEY` are present and valid. Production also requires an explicit comma-separated `ALLOWED_ORIGINS` list.

Cookie behavior is controlled by `COOKIE_SECURE`, `COOKIE_SAME_SITE`, and optional `COOKIE_DOMAIN`. Cross-site production cookies require `SameSite=None` and `Secure=true`; local development defaults to `Lax` without Secure.

The frontend reads `VITE_API_BASE_URL` and otherwise uses the local development API at `http://localhost:3000/api`. Production builds must set this variable.

## CSRF

`GET /api/auth/csrf` issues a random double-submit token. Every authenticated unsafe user/admin request and login/logout request must present the same token in the `csrf_token` cookie and `X-CSRF-Token` header. The frontend API client fetches, caches, and refreshes it automatically.

## Login controls

Five failed attempts for the same IP/user key in 15 minutes are allowed; the sixth receives HTTP 429 with `Retry-After`. Successful authentication clears the counter. Success, failure, and rate-limit outcomes are written to `AuditLog` without passwords.

The counter is shared across every API instance and serverless invocation in the same Redis deployment (`REDIS_URL`, namespaced under `BULLMQ_PREFIX`), so the limit holds under multi-instance and serverless deployment rather than resetting per process or per cold start. The limiter fails open: if Redis is unreachable, the login attempt is allowed rather than blocking all authentication on an unrelated infrastructure outage, and the attempt is still written to `AuditLog` either way.

## Response policy

Customer responses do not include plaintext passwords, stack traces, raw provider failures, or provider response bodies. Detailed errors remain server-side logs and controlled audit/provider-attempt evidence.
