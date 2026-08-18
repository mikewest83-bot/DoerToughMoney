# DoerToughMoney pivot (2026-08-18)

Abandoned the P2P/money-transmission direction entirely — DoerToughMoney no
longer sends or holds anyone else's money. Rebuilt the backend around the
combined product: **DoerToughMoney** (personal finance: accounts,
transactions, bills, budgets, goals) as the primary product, with
**DealTough** (savings/negotiation AI) integrated as a feature rather than a
separate app. Full plan/rationale lives in the conversation this was built
from; summary of what changed:

**Removed** (`server/dwolla/*`, `server/payments.js`, all Dwolla admin
scripts): Dwolla bank-to-bank transfers, identity verification/KYC,
`/api/pay`, `/api/bank/*`, `/api/verify-identity`, `/api/disputes` (Reg E),
`/api/request`, the Dwolla webhook, and the `Transfer`/`Dispute`/`Request`
Prisma models + `User.dwollaCustomerUrl`/`kycStatus`/`fundingSource*` — see
migration `0011_doertoughmoney_pivot`. Shared/group expense tracking is kept,
but `POST /api/groups/:id/settle` now only records a cash payoff — there's no
transfer-based settle path anymore.

**Added**: `PlaidItem`/`Account`/`Transaction`/`Bill`/`Budget`/`Goal` Prisma
models; `server/plaid/*` (lazy client, Link token + public-token exchange,
cursor-based transaction sync, webhook handling — same lazy-init/graceful-
degrade pattern the old `dwolla/client.js` used); `server/insights.js`
(spending by category, month-over-month, budget/goal status — pure functions,
unit-testable like `logic.js`/`groups.js`); `server/dealtough.js` (calls
DealTough's real `POST /api/v1/deals/analyze` for one-time purchase
decisions — bill-negotiation is a documented stub, since DealTough's current
engine scores marketplace listings against comparables, not recurring bills,
and that's genuinely new work); new routes for accounts, transactions, bills,
budgets, goals, insights, and Plaid linking in `server/server.js`.

**Also fixed while in there**: the JWT signing secret had a hardcoded
`"dev_only_change_me"` fallback that only got blocked if `NODE_ENV` was
exactly `"production"` — a missing/misspelled `NODE_ENV` would have silently
let the app boot with a forgeable, publicly-known secret on a live deploy.
`validateProductionConfig()` in `config.js` now runs unconditionally instead.

**Not done yet — see the delivery notes for full detail**: the frontend
(`web/`) still targets the old payments API and needs its own rewrite; Plaid
and DealTough both need real credentials/URLs before those routes work; the
`0011_doertoughmoney_pivot` migration is destructive (drops the Dwolla-era
tables) and has been verified against a reconstructed copy of the current
production schema, but has NOT been run against the actual production
database — confirm before deploying.

# Reliability and security fixes

## Applied

- Cash-outs now reserve a ledger transaction, save Stripe transfer/payout IDs, and restore the wallet exactly once when payout creation fails.
- Later `payout.failed` and `payout.canceled` webhooks restore the wallet; `payout.paid` finalizes the ledger transaction.
- Stripe Checkout top-ups are deduplicated by both webhook event ID and Checkout Session ID.
- Money-request feed direction is corrected for both requester and payer.
- Self-requests are rejected.
- Production startup now fails when required secrets are missing or the JWT secret is too short.
- Stripe is initialized lazily and no longer uses a fake fallback secret.
- Idempotency responses are saved before being sent and key length is validated.
- Email and handle normalization/validation were added.
- A $10,000 per-transaction validation limit was added.
- Prisma migration `0002_stripe_reconciliation` adds provider reconciliation fields and a Stripe event table.
- Unit/integration tests were expanded for request direction, payout restoration, transaction limits, and duplicate top-ups.

## Deployment requirement

Run Prisma migrations before starting the updated server. Configure the Stripe webhook endpoint to receive platform Checkout events and connected-account payout events.

## Platform fee (revenue)

- A configurable platform fee is taken from the sender on each payment and
  credited to a dedicated platform account (`@even`, seeded by migration
  `0003_platform_fee`), so fee revenue is real balance you can cash out.
- Configured via env: `PLATFORM_FEE_BPS` (basis points), `PLATFORM_FEE_FLAT_CENTS`,
  and optional `PLATFORM_FEE_CAP_CENTS`. All default to off.
- The recipient always receives the full amount; the sender pays amount + fee,
  enforced atomically by the same overdraw guard.
- `GET /api/config` exposes the fee so the client previews it before sending.
- `Transaction.feeCents` records the fee per payment for reporting.

## Pay-me links + QR (creative feature) & Replit

- Any user can create a shareable pay-me link (fixed or payer-chooses amount)
  with a QR code. Anyone can pay it by card via Stripe Checkout — no account
  needed — and the funds land in the recipient's wallet (minus platform fee).
- New `PaymentLink` model + migration `0004_payment_links`; public routes
  `GET /api/links/:slug` and `POST /api/links/:slug/checkout`; authed
  create/list/deactivate.
- Webhook now branches on `metadata.kind === "link"` and credits the payee via
  `processLinkPayment`, deduped by event ID and Checkout Session ID.
- Frontend: link-creation UI with copy + QR, and a standalone `/pay/:slug`
  page (client-side routed, no auth).
- Replit: single-service setup (`.replit`, `replit-run.sh`) — the API serves the
  built web app on one origin; `SERVE_WEB=1` enables static + SPA fallback so
  `/pay/:slug` survives refresh. Client uses same-origin `/api` in production.
