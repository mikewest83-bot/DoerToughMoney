# DoerToughMoney Changelog

## 2026-08-19 — Production Audit & Launch-Readiness Cleanup

**Status**: Pre-launch — passing all health checks; critical integration work remains.

### Audit Summary

✅ **Passing**
- Database schema and all 11 migrations validated (including destructive 0011_doertoughmoney_pivot)
- `/api/health` healthcheck returns 200 OK
- Production build succeeds (Vite + Nixpacks, 0 vulnerabilities in bundle)
- Environment configuration validated (`NODE_ENV` strict check, JWT_SECRET minimum length enforced)
- Frontend/backend API contract confirmed (no missing endpoints, all routes mapped)
- Shared expense sweep job active and scheduled (cron sweep for recurring bill materialization)
- Resource utilization healthy (CPU <0.007%, Memory 145MB of 8GB limit)

❌ **Blockers — Integration Work**
1. **Plaid Credentials Missing**
   - `PLAID_CLIENT_ID` and `PLAID_SECRET` not configured
   - Bank linking routes (`/api/plaid/*`) will return 503 "Bank linking isn't available"
   - **Fix**: Obtain Plaid sandbox or production credentials; set env vars

2. **DealTough API Not Wired**
   - `DEALTOUGH_API_URL` not configured
   - Purchase analysis endpoint (`/api/dealtough/analyze`) will return 503
   - **Fix**: Set `DEALTOUGH_API_URL` to a running DealTough deployment

⚠️ **High Priority — Security & Maintenance**
1. Plaid access tokens stored in plaintext (pre-launch task: implement envelope encryption)
2. 8 server vulnerabilities, 5 web vulnerabilities (mostly transitive; run `npm audit fix`)
3. Prisma v5.19.0 → v7.9.1 upgrade (major version, requires testing but recommended)

### Code Changes (This Commit)

- **package.json**: `name` changed from `even-app` to `doertoughmoney`
- **README.md**: Completely rewritten to describe DoerToughMoney (Plaid accounts, transactions, bills, budgets, goals, insights, DealTough purchase analysis, shared expenses) — removed all P2P payment, Stripe, Dwolla, and payment-link instructions
- **SECURITY.md**: Replaced generic template with DoerToughMoney security policy, including:
  - Critical task: Plaid access-token encryption pre-launch
  - High-priority: Dependency security (npm audit fix)
  - Operational security (rate limiting, secrets management, API security)
  - Known limitations and compliance notes
  - Pre-launch security checklist
- **CHANGES.md**: Updated this file with audit findings and launch-readiness status

### No Changes (Preserved)
- All migrations (including 0011_doertoughmoney_pivot)
- Prisma version (v5.19.0; upgrade tracked as separate work)
- Secrets, database schema, or data
- Tests or build configuration

### Next Steps

**Before Accepting Live User Data**:
1. Provision Plaid credentials (sandbox → production on schedule)
2. Deploy or connect to DealTough service
3. Implement Plaid access-token encryption (envelope-encrypt using KMS)
4. Address npm audit vulnerabilities
5. Update Terms and Privacy pages (current versions already rewritten pre-pivot)

**Optional Pre-Launch**:
- Upgrade Prisma to v7.x
- Add 2FA (sign-in security)
- Implement Plaid webhook signature validation
- Enable database row-level security (RLS)

---

## 2026-08-18 — Backend Pivot: DoerToughMoney

Abandoned the P2P/money-transmission direction entirely — DoerToughMoney no longer sends or holds anyone else's money. Rebuilt the backend around the combined product: **DoerToughMoney** (personal finance: accounts, transactions, bills, budgets, goals) as the primary product, with **DealTough** (savings/negotiation AI) integrated as a feature rather than a separate app. Full plan/rationale lives in the conversation this was built from; summary of what changed:

**Removed** (`server/dwolla/*`, `server/payments.js`, all Dwolla admin scripts): Dwolla bank-to-bank transfers, identity verification/KYC, `/api/pay`, `/api/bank/*`, `/api/verify-identity`, `/api/disputes` (Reg E), `/api/request`, the Dwolla webhook, and the `Transfer`/`Dispute`/`Request` Prisma models + `User.dwollaCustomerUrl`/`kycStatus`/`fundingSource*` — see migration `0011_doertoughmoney_pivot`. Shared/group expense tracking is kept, but `POST /api/groups/:id/settle` now only records a cash payoff — there's no transfer-based settle path anymore.

**Added**: `PlaidItem`/`Account`/`Transaction`/`Bill`/`Budget`/`Goal` Prisma models; `server/plaid/*` (lazy client, Link token + public-token exchange, cursor-based transaction sync, webhook handling — same lazy-init/graceful-degrade pattern the old `dwolla/client.js` used); `server/insights.js` (spending by category, month-over-month, budget/goal status — pure functions, unit-testable like `logic.js`/`groups.js`); `server/dealtough.js` (calls DealTough's real `POST /api/v1/deals/analyze` for one-time purchase decisions — bill-negotiation is a documented stub, since DealTough's current engine scores marketplace listings against comparables, not recurring bills, and that's genuinely new work); new routes for accounts, transactions, bills, budgets, goals, insights, and Plaid linking in `server/server.js`.

**Also fixed while in there**: the JWT signing secret had a hardcoded `"dev_only_change_me"` fallback that only got blocked if `NODE_ENV` was exactly `"production"` — a missing/misspelled `NODE_ENV` would have silently let the app boot with a forgeable, publicly-known secret on a live deploy. `validateProductionConfig()` in `config.js` now runs unconditionally instead.

**Not done yet — see the delivery notes for full detail**: Plaid and DealTough both need real credentials/URLs before those routes work; the `0011_doertoughmoney_pivot` migration is destructive (drops the Dwolla-era tables) and has been verified against a reconstructed copy of the current production schema, but has NOT been run against the actual production database — confirm before deploying.

## 2026-08-18 — Frontend Rewrite

`web/` now matches the pivoted backend — it no longer targets the old payments API and will not compile/run against the pre-pivot server.

**Removed**: the Pay/Request modal (numeric keypad, speed picker, fee preview), the dispute sheet, the identity-verification (KYC/SSN/DOB/address) sheet and the matching fields on both the password- and Google-registration forms, and the old bank-linking sheets (manual routing/account entry, micro-deposit verification, the Dwolla-Open-Banking instant-link launcher).

**Added**: a tabbed shell — Home, Accounts, Transactions, Bills, Budgets, Goals, Insights, DealTough, and the existing Shared (group expenses) screen. Accounts uses `react-plaid-link` (already a dependency from an earlier attempt) wired to the new `/api/plaid/*` routes for connecting/removing a bank and syncing. Transactions supports filtering by category and tagging a transaction with a category or bill. Bills/Budgets/Goals are full CRUD against the new routes, with budgets showing spend-vs-limit progress pulled from `/api/insights`. The DealTough tab is a "can I get this cheaper?" form for one-time purchases against the real `/api/dealtough/analyze` endpoint; bill negotiation is explicitly labeled "coming soon" in the UI rather than wired to a button that would hit the backend's documented stub.

`web/src/Groups.jsx`'s `SettleSheet` no longer branches on a transfer speed/method — it's a single cash-record flow matching the new `POST /api/groups/:id/settle { toMemberId, amount }` signature.

Terms/Privacy pages were rewritten to drop the Dwolla/SSN/bank-transfer language and describe what the app actually does now (Plaid-linked read-only account data, DealTough as a separate analysis provider, no money custody or transmission). Branding (`index.html`, `vite.config.js`'s PWA manifest, `package.json` name) was updated from "even" to "DoerToughMoney".

Verified with `npx vite build` (production build succeeds, no missing imports/unused-import cruft) — not yet tested against a running backend with real Plaid/DealTough credentials, since those need to be provisioned first.

## Reliability and security fixes (earlier)

### Applied

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

### Deployment requirement

Run Prisma migrations before starting the updated server. Configure the Stripe webhook endpoint to receive platform Checkout events and connected-account payout events.

### Platform fee (revenue)

- A configurable platform fee is taken from the sender on each payment and credited to a dedicated platform account (`@even`, seeded by migration `0003_platform_fee`), so fee revenue is real balance you can cash out.
- Configured via env: `PLATFORM_FEE_BPS` (basis points), `PLATFORM_FEE_FLAT_CENTS`, and optional `PLATFORM_FEE_CAP_CENTS`. All default to off.
- The recipient always receives the full amount; the sender pays amount + fee, enforced atomically by the same overdraw guard.
- `GET /api/config` exposes the fee so the client previews it before sending.
- `Transaction.feeCents` records the fee per payment for reporting.

### Pay-me links + QR (creative feature) & Replit

- Any user can create a shareable pay-me link (fixed or payer-chooses amount) with a QR code. Anyone can pay it by card via Stripe Checkout — no account needed — and the funds land in the recipient's wallet (minus platform fee).
- New `PaymentLink` model + migration `0004_payment_links`; public routes `GET /api/links/:slug` and `POST /api/links/:slug/checkout`; authed create/list/deactivate.
- Webhook now branches on `metadata.kind === "link"` and credits the payee via `processLinkPayment`, deduped by event ID and Checkout Session ID.
- Frontend: link-creation UI with copy + QR, and a standalone `/pay/:slug` page (client-side routed, no auth).
- Replit: single-service setup (`.replit`, `replit-run.sh`) — the API serves the built web app on one origin; `SERVE_WEB=1` enables static + SPA fallback so `/pay/:slug` survives refresh. Client uses same-origin `/api` in production.

