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
