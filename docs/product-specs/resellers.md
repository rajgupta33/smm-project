# Resellers, commission and WhatsApp marketing

Implemented September 2026. Phase 3 and 4 of `docs/exec-plans/reseller-and-monitoring.md`.

## What a reseller is

A reseller is an ordinary `user` account with a `ResellerProfile` attached. It is
deliberately *not* a third role: every existing route guard, wallet path, order
flow and support ticket keeps working unchanged, and a reseller can still place
orders, top up and raise tickets like any other customer.

Resellers are created by an admin only. There is no public reseller signup.

## Earning

A reseller earns on two kinds of order:

| Attribution | Meaning |
|---|---|
| `OWN_ORDER` | The reseller placed the order themselves, for their own customer. |
| `REFERRAL` | A customer attributed to the reseller placed the order. |

Commission is a share of the order's **profit** (`pricingSnapshot.grossSpreadMinor`),
never of the order total, and is always rounded **down**:

```
commissionMinor = floor(grossSpreadMinor × commissionBps / 10000)
```

so a payout can never exceed what the order actually earned. The rate is stored
per reseller in basis points (2500 = 25%) and is snapshotted onto each ledger
entry at accrual, so changing a reseller's rate never rewrites history.

### Commission lifecycle

```
PENDING  ──order completes──▶ HELD ──hold expires──▶ AVAILABLE ──wallet credit──▶ PAID
   │                           │                         │
   └──────────── order refunded (proportional) ──────────┴──▶ REVERSED
```

* **PENDING** — the order exists and is running.
* **HELD** — the order completed; the hold period (default 7 days, per reseller)
  protects against later refunds and refill clawbacks.
* **AVAILABLE** — the hold has expired; the payout sweep will credit it.
* **PAID** — credited to the reseller's panel wallet through `walletService`.
  Wallet credit only; there is no cash withdrawal.
* **REVERSED** — the order was refunded before payout. A partial refund reverses
  proportionally and leaves the remainder payable.

### Why accrual is reconciled, not hooked

`commissionService` re-derives what each order owes from the orders themselves
rather than firing on an order-creation or status-change hook. A unique
`(resellerProfileId, orderId)` index makes each pass idempotent, so a replayed
job, a double status poll and a dashboard refresh happening at once cannot
create or pay a second commission.

The sweep runs on the `reseller-jobs` queue every `RESELLER_PAYOUT_SCAN_MINUTES`
(default 60). The reseller dashboard also reconciles just that reseller's recent
orders on load, so a completed order shows up immediately rather than waiting an
hour.

## Attribution

`User.referredBy` points at a `ResellerProfile` and is set once, at account
creation, from the referral code an admin enters on the create-user form.
Changing it afterwards requires `POST /api/admin/resellers/reassignCustomer`,
which writes a `RESELLER_ATTRIBUTION_CHANGED` audit entry.

A `PAUSED` or `DISABLED` reseller stops accruing new commission but keeps
everything already in the ledger.

## WhatsApp marketing

Each reseller has a Marketing section, on by default (`marketingEnabled`). The
content is assigned by an admin and never by the reseller.

### How the sheet is wired

The admin creates a **campaign** pointing at a Google Sheet (link, tab, column
mapping, row range). The backend reads and stamps that sheet through a Google
Apps Script web app (`tools/promo-sheet/Code.gs`, the same contract as the
standalone WA Sender PWA: `ping` / `tabs` / `rows` / `mark`).

The script URL and secret live only in backend configuration
(`PROMO_SHEET_SCRIPT_URL`, `PROMO_SHEET_SECRET_KEY`). `spreadsheetId` and
`sheetUrl` are `select: false` on the campaign model. A reseller therefore never
learns the sheet link, the tab or the key — they call the panel API, which
returns one contact at a time.

### Lead pool

Sheet rows are mirrored into `PromoLead` on sync. That local mirror is what makes
a claim atomic:

```
AVAILABLE ──claim──▶ CLAIMED ──confirmed sent──▶ SENT ──cooldown──▶ AVAILABLE
                         │                          │
                    claim expires              contact limit reached
                         ▼                          ▼
                     AVAILABLE                  EXHAUSTED
```

* A claim is a single guarded `findOneAndUpdate` on `state: 'AVAILABLE'`, so two
  resellers clicking simultaneously can never receive the same person.
* `contactedByProfileIds` keeps a re-released number away from the reseller who
  already messaged it.
* A claim that is never confirmed expires after `claimExpiryMinutes` (default 30)
  and returns to the pool.
* A contacted number returns to the pool after `releaseAfterDays` (default 30) so
  a different reseller can retry it, up to `maxContactsPerNumber` (default 2).
  Set `releaseAfterDays: 0` for "each number used once".
* Rows the sheet already marks as sent are imported as `EXHAUSTED`, so importing
  a previously-worked sheet does not re-contact everyone.

### Sending

The panel cannot observe WhatsApp. After the reseller taps **Send**, WhatsApp
opens with the message pre-written; on return the panel asks explicitly whether
it went out. "Yes" stamps the sheet and retires the number; "No, put it back"
returns it to the pool without counting against the daily cap. Guessing either
way would burn a lead or double-message someone.

If the sheet write-back fails, the lead is still marked sent locally — so the
number cannot be handed to another reseller — and the sweeper retries the write.

### Safety rails

These are not optional decoration. WhatsApp bans numbers that bulk-message
people who have not saved them, and unsolicited promotion breaches India's DPDP
Act.

* Per-reseller daily cap (`dailyShareCap`, default 100), overridable per campaign.
* Hard ceiling on how many times one number may ever be contacted.
* An opt-out button that removes a number from **every** campaign permanently.
* Only a real WhatsApp URL from the sheet is opened as-is; anything else falls
  back to the campaign template, so a malformed or hostile cell cannot redirect a
  reseller off-platform.

## API surface

Admin (`/api/admin`, behind `requireAdmin`):

| Method | Path |
|---|---|
| GET/POST | `/resellers` |
| POST | `/resellers/convert` |
| GET/PATCH | `/resellers/:profileId` |
| POST | `/resellers/reassignCustomer` |
| POST | `/resellers/commissionScan` |
| GET/POST | `/promoCampaigns` |
| GET | `/promoCampaigns/sheetTabs` |
| GET/PATCH | `/promoCampaigns/:campaignId` |
| POST | `/promoCampaigns/:campaignId/sync` |
| GET | `/promoCampaigns/:campaignId/leads` |

Reseller (`/api/reseller`, behind `requireReseller`, which loads the profile from
the database — a browser-supplied role or profile id is never trusted):

| Method | Path |
|---|---|
| GET | `/dashboard`, `/commissions`, `/customers` |
| GET | `/marketing` |
| POST | `/marketing/leads/claim` |
| POST | `/marketing/leads/:leadId/sent` |
| POST | `/marketing/leads/:leadId/release` |
| POST | `/marketing/leads/:leadId/optOut` |

## Configuration

See the reseller block in `backend/env.example`. Marketing stays switched off
until `PROMO_SHEET_SCRIPT_URL` and `PROMO_SHEET_SECRET_KEY` are set; the admin
campaigns page says so explicitly rather than failing silently.

## Not included

* **Public customer signup at `/r/<code>`.** The panel has no self-signup at all
  yet, and which services a self-signed-up customer may see is still undecided.
  Attribution works today through the referral-code field on the admin's
  create-user form, so the commission engine is fully exercised without it.
* **Cash payout.** Commission is wallet credit only, by decision.
