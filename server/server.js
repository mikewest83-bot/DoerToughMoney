import "dotenv/config";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import "express-async-errors"; // route async throws reach the error handler below
import cors from "cors";
import rateLimit from "express-rate-limit";

import { register, login, authRequired, publicUser } from "./auth.js";
import {
  getUserById, getUserByHandle, searchUsers,
  transfer, logRequest, reservePayout, attachPayoutProviderIds,
  completePayout, failAndRestorePayout, feedForUser,
  createPaymentLink, getPaymentLinkWithPayee, listPaymentLinks, deactivatePaymentLink,
} from "./db.js";
import { onboardingLink, topupCheckout, cashOut, linkCheckout, handleWebhook } from "./stripe.js";
import { idempotency } from "./idempotency.js";
import { validateAmount, shapeTxn, computeFee, resolveLinkAmount, linkUrl } from "./logic.js";
import { validateProductionConfig, feeParams, PLATFORM_USER_ID } from "./config.js";

validateProductionConfig();

const app = express();
app.set("trust proxy", 1); // behind Railway's proxy — needed for correct rate-limit IPs
app.use(cors({ origin: process.env.WEB_ORIGIN || "http://localhost:5173" }));

// Stripe webhook needs the RAW body, so mount it BEFORE express.json() and the limiter.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleWebhook);

app.use(express.json());

// ── rate limiting ────────────────────────────────────────
const limit = (max, message) =>
  rateLimit({ windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false, message: { error: message } });

const apiLimiter = limit(120, "Too many requests. Give it a minute.");
const authLimiter = limit(12, "Too many attempts. Wait a minute and try again.");
const moneyLimiter = limit(30, "Slow down a moment and try again.");

app.use("/api", apiLimiter);

const idemOf = (req) => req.headers["idempotency-key"] || randomUUID();

// Public: lets the client preview the platform fee before a payment.
app.get("/api/config", (_req, res) => {
  const { bps, flatCents, capCents } = feeParams();
  res.json({ feeBps: bps, feeFlatCents: flatCents, feeCapCents: Number.isFinite(capCents) ? capCents : null });
});

// ── auth ─────────────────────────────────────────────────
app.post("/api/register", authLimiter, register);
app.post("/api/login", authLimiter, login);

// ── me ───────────────────────────────────────────────────
app.get("/api/me", authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/feed", authRequired, async (req, res) => {
  const rows = (await feedForUser(req.user.id)).map((t) => shapeTxn(t, req.user.id));
  res.json({ feed: rows });
});

app.get("/api/users", authRequired, async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  res.json({ users: await searchUsers(q, req.user.id) });
});

// ── pay (internal ledger transfer) ───────────────────────
app.post("/api/pay", authRequired, moneyLimiter, idempotency, async (req, res) => {
  const { handle, amount, note } = req.body || {};
  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const recipient = await getUserByHandle(handle);
  if (!recipient) return res.status(404).json({ error: "No one with that handle." });
  if (recipient.id === req.user.id) return res.status(400).json({ error: "You can't pay yourself." });

  const feeCents = computeFee(v.cents, feeParams());

  try {
    await transfer({ fromId: req.user.id, toId: recipient.id, cents: v.cents, note, feeCents, platformId: PLATFORM_USER_ID });
  } catch (e) {
    if (e.message === "INSUFFICIENT")
      return res.status(400).json({ error: "Not enough to cover this. Add money or lower the amount." });
    throw e;
  }
  res.json({ user: publicUser(await getUserById(req.user.id)), feeCents, amountCents: v.cents });
});

// ── request money ────────────────────────────────────────
app.post("/api/request", authRequired, moneyLimiter, idempotency, async (req, res) => {
  const { handle, amount, note } = req.body || {};
  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const from = await getUserByHandle(handle);
  if (!from) return res.status(404).json({ error: "No one with that handle." });
  if (from.id === req.user.id) return res.status(400).json({ error: "You can't request money from yourself." });
  await logRequest({ payerId: from.id, requesterId: req.user.id, cents: v.cents, note });
  res.json({ ok: true });
});

// ── add funds (Stripe Checkout) ──────────────────────────
app.post("/api/topup", authRequired, moneyLimiter, idempotency, async (req, res) => {
  const v = validateAmount(req.body?.amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const url = await topupCheckout(req.user, v.cents, idemOf(req));
  res.json({ url });
});

// ── connect a bank for cash-outs ─────────────────────────
app.post("/api/bank/link", authRequired, moneyLimiter, async (req, res) => {
  const url = await onboardingLink(req.user);
  res.json({ url });
});

// ── cash out to bank ─────────────────────────────────────
app.post("/api/cashout", authRequired, moneyLimiter, idempotency, async (req, res) => {
  const v = validateAmount(req.body?.amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  if (!req.user.stripeAccountId)
    return res.status(400).json({ error: "Connect a bank account first." });

  let payoutTxn;
  try {
    payoutTxn = await reservePayout({ userId: req.user.id, cents: v.cents });
  } catch (e) {
    if (e.message === "INSUFFICIENT")
      return res.status(400).json({ error: "Not enough in your balance for that cash-out." });
    throw e;
  }

  try {
    const ids = await cashOut(req.user, v.cents, idemOf(req), payoutTxn.id);
    await attachPayoutProviderIds({ transactionId: payoutTxn.id, ...ids });
    // Stripe may later send payout.failed/canceled; payout.paid finalizes it.
    if (!process.env.STRIPE_WEBHOOK_SECRET) await completePayout({ transactionId: payoutTxn.id });
  } catch (e) {
    await failAndRestorePayout({ transactionId: payoutTxn.id });
    throw e;
  }
  res.json({ user: publicUser(await getUserById(req.user.id)) });
});


// ── pay-me links ─────────────────────────────────────────
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";

// Create a shareable link. Optional fixed amount; omit for payer-chooses.
app.post("/api/links", authRequired, moneyLimiter, async (req, res) => {
  const { amount, note } = req.body || {};
  let amountCents = null;
  if (amount !== undefined && amount !== null && amount !== "") {
    const v = validateAmount(amount);
    if (!v.ok) return res.status(400).json({ error: v.error });
    amountCents = v.cents;
  }
  const link = await createPaymentLink({ userId: req.user.id, amountCents, note: (note || "").slice(0, 140) });
  res.json({ link: { slug: link.slug, amountCents: link.amountCents, note: link.note, active: link.active }, url: linkUrl(WEB_ORIGIN, link.slug) });
});

app.get("/api/links", authRequired, async (req, res) => {
  const links = await listPaymentLinks(req.user.id);
  res.json({ links: links.map((l) => ({ slug: l.slug, amountCents: l.amountCents, note: l.note, active: l.active, url: linkUrl(WEB_ORIGIN, l.slug) })) });
});

app.post("/api/links/:slug/deactivate", authRequired, async (req, res) => {
  const link = await getPaymentLinkWithPayee(req.params.slug);
  if (!link) return res.status(404).json({ error: "Link not found." });
  await deactivatePaymentLink({ id: link.id, userId: req.user.id });
  res.json({ ok: true });
});

// Public: fetch a link so the pay page can render (no account required).
app.get("/api/links/:slug", async (req, res) => {
  const link = await getPaymentLinkWithPayee(req.params.slug);
  if (!link || !link.active) return res.status(404).json({ error: "This link is no longer active." });
  res.json({ link: { slug: link.slug, amountCents: link.amountCents, note: link.note, payee: link.payee } });
});

// Public: start Checkout for a link. Anyone can pay.
app.post("/api/links/:slug/checkout", async (req, res) => {
  const link = await getPaymentLinkWithPayee(req.params.slug);
  if (!link || !link.active) return res.status(404).json({ error: "This link is no longer active." });
  const resolved = resolveLinkAmount(link, req.body?.amount);
  if (!resolved.ok) return res.status(400).json({ error: resolved.error });
  const feeCents = computeFee(resolved.cents, feeParams());
  const url = await linkCheckout({ link, payeeId: link.userId, cents: resolved.cents, note: link.note, feeCents });
  res.json({ url });
});

// Serve the built web app from the same origin (used on Replit). SPA fallback
// so client routes like /pay/:slug work on refresh. API + webhook are untouched.
if (process.env.SERVE_WEB) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(__dirname, "../web/dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Anything a route throws lands here as clean JSON instead of a hung request.
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`even server on :${PORT}`));

export default app;
