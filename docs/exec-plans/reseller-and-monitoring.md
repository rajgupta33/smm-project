# Reseller program and panel monitoring

Planned 14 September 2026. Decisions below were confirmed by the owner.

## Decisions

| Topic | Decision |
|---|---|
| Reseller model | A reseller either places orders for their own customers on this panel, or shares a referral link so customers sign up and order themselves. Both earn commission. |
| Commission | 25% of the order's profit (`pricingSnapshot.grossSpreadMinor`), never of the order amount, so commission cannot exceed profit. `commissionMinor = floor(grossSpreadMinor × 2500 / 10000)`. Rate stored per reseller so it can change later. |
| Customer attribution | Public signup page with referral links (`/r/<code>`). Attribution is fixed at signup; only an admin can change it, with an audit entry. |
| Payout | Commission is credited to the reseller's wallet only (no cash withdrawal). |
| WhatsApp promotion | Each master-sheet row holds a phone number and a message. A reseller's click claims the next unused row and opens `https://wa.me/<number>?text=<message>`. |
| Master data source | Google Sheet, synced by the backend. |
| Removed provider service | Automatically hide the catalogue service when the removal is confirmed and no fallback provider offer is available. |
| Currency | INR. |
| Alert delivery | Admin panel only. |

## Phases

1. **Done: alert center and provider balance monitoring.** See `docs/product-specs/admin-alerts.md`.
2. **Done: scheduled service health check.** See `docs/product-specs/service-availability.md`. Runs the existing report-only provider sync hourly by default (`SERVICE_AVAILABILITY_CHECK_MINUTES`), auto-applies availability changes only (never prices), and auto-hides a catalogue service when a confirmed removal leaves no other offer covering it.
3. **Done: reseller accounts and commission ledger.** See `docs/product-specs/resellers.md`. `ResellerProfile` (code, commission basis points, hold days, status) linked to a normal `user`, so existing role checks keep working. Admin-created only; `User.referredBy` is set from a referral code on the admin create-user form. An immutable `CommissionLedger` with one entry per order enforced by a unique `(resellerProfileId, orderId)` key: `PENDING` → `HELD` (order completed) → `AVAILABLE` (hold ends) → `PAID` (wallet credit through `walletService`); `REVERSED` if refunded first, proportional for partial refunds. Accrual is reconciled from the orders rather than hooked into order creation, which keeps it idempotent.
4. **Done: reseller dashboard and WhatsApp promotion.** See `docs/product-specs/resellers.md`. Earnings, referred customers, commission ledger. Admin-assigned Google Sheet campaigns synced into a `PromoLead` pool, atomic lead claim per click, per-reseller daily cap, "couldn't send" button that returns a lead, opt-out that retires a number everywhere, and a cooldown that re-releases an unconverted number to a *different* reseller after `releaseAfterDays`.
5. **Extras.** Reseller price-list export, service-change notices to resellers, reseller API access.

## Decisions taken at implementation (September 2026)

- **Who becomes a reseller:** admin creates the account from the panel. No apply-and-approve flow, no public reseller signup.
- **Commission hold:** 7 days after the order completes, configurable globally (`RESELLER_COMMISSION_HOLD_DAYS`) and per reseller.
- **Sheet access:** the backend proxies one Apps Script web app; the admin assigns sheet + tab + columns + row range per campaign. The reseller never sees the link or the key.
- **Sheet write-back:** yes. The backend stamps the status column with "Sent &lt;timestamp&gt; by &lt;reseller&gt;", and retries through the sweeper if Apps Script is unreachable.
- **Number reuse:** shared pool with an atomic claim; an unconverted number is re-released to a *different* reseller after `releaseAfterDays` (default 30), capped by `maxContactsPerNumber` (default 2). Set `releaseAfterDays: 0` for one-contact-only.

## Still open

- Which services can a self-signed-up customer see and order? Services are currently assigned per user, which is why public signup at `/r/<code>` is not built yet — attribution runs through the admin create-user form instead.

## Risks

- WhatsApp may ban numbers that message many people who have not saved them, and unsolicited promotional messages can breach WhatsApp policy and India's DPDP Act. Leads should come from people who agreed to be contacted; keep the daily cap and honour opt-outs.
- The panel cannot confirm a WhatsApp message was sent. Clicks are recorded as shares; referral-link signups are the reliable measure.
