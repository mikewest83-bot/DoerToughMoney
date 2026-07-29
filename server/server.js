import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import "express-async-errors"; // route async throws reach the error handler below
import cors from "cors";
import rateLimit from "express-rate-limit";

import { register, login, authRequired, publicUser } from "./auth.js";
import prisma, {
  getUserById, getUserByHandle, searchUsers, feedForUser,
  createTransferRecord, logRequest, newIdempotencyKey,
  setFundingSource, setFundingSourceVerified, setKycStatusByCustomerUrlSuffix,
} from "./db.js";
import {
  dwollaWebhook, checkVelocity, VelocityError, createTransfer,
  addBankManual, initiateMicroDeposits, verifyMicroDeposits,
} from "./dwolla/index.js";
import { idempotency } from "./idempotency.js";
import { validateAmount, shapeTxn, computeFee } from "./logic.js";
import { validateProductionConfig, feeParams } from "./config.js";

validateProductionConfig();

const app = express();
app.set("trust proxy", 1); // behind Railway's proxy — needed for correct rate-limit IPs
app.use(cors({ origin: process.env.WEB_ORIGIN || "http://localhost:5173" }));

// Dwolla webhook needs the RAW body, so mount it BEFORE express.json() and the limiter.
app.post(
  "/webhooks/dwolla",
  express.raw({ type: "application/json" }),
  dwollaWebhook(prisma, {
    onCustomerVerified: async (dwollaCustomerId) => {
      await setKycStatusByCustomerUrlSuffix(dwollaCustomerId, "VERIFIED");
    },
    onDocumentNeeded: async (dwollaCustomerId) => {
      await setKycStatusByCustomerUrlSuffix(dwollaCustomerId, "DOCUMENT");
    },
  })
);

app.use(express.json());

// ── rate limiting ────────────────────────────────────────
const limit = (max, message) =>
  rateLimit({ windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false, message: { error: message } });

const apiLimiter = limit(120, "Too many requests. Give it a minute.");
const authLimiter = limit(12, "Too many attempts. Wait a minute and try again.");
const moneyLimiter = limit(30, "Slow down a moment and try again.");

app.use("/api", apiLimiter);

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

// ── link a bank (manual routing/account + micro-deposits) ──
app.post("/api/bank/link", authRequired, moneyLimiter, async (req, res) => {
  const { routingNumber, accountNumber, bankAccountType, name } = req.body || {};
  if (!routingNumber || !accountNumber || !bankAccountType)
    return res.status(400).json({ error: "Routing number, account number, and account type are required." });
  if (!req.user.dwollaCustomerUrl) return res.status(400).json({ error: "Finish identity verification first." });

  const fundingSourceUrl = await addBankManual(req.user.dwollaCustomerUrl, { routingNumber, accountNumber, bankAccountType, name });
  await initiateMicroDeposits(fundingSourceUrl);
  await setFundingSource(req.user.id, fundingSourceUrl);
  res.json({ ok: true });
});

// ── verify a bank via the two micro-deposit amounts ─────────
app.post("/api/bank/verify", authRequired, moneyLimiter, async (req, res) => {
  const { amount1, amount2 } = req.body || {};
  const a1 = validateAmount(amount1);
  const a2 = validateAmount(amount2);
  if (!a1.ok || !a2.ok) return res.status(400).json({ error: "Enter both micro-deposit amounts." });
  if (!req.user.fundingSourceUrl) return res.status(400).json({ error: "Link a bank account first." });

  try {
    await verifyMicroDeposits(req.user.fundingSourceUrl, a1.cents, a2.cents);
  } catch {
    return res.status(400).json({ error: "Those amounts don't match. Check your bank statement and try again." });
  }
  await setFundingSourceVerified(req.user.id);
  res.json({ user: publicUser(await getUserById(req.user.id)) });
});

// ── pay (real bank-to-bank transfer via Dwolla) ─────────────
app.post("/api/pay", authRequired, moneyLimiter, idempotency, async (req, res) => {
  const { handle, amount, note } = req.body || {};
  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const recipient = await getUserByHandle(handle);
  if (!recipient) return res.status(404).json({ error: "No one with that handle." });
  if (recipient.id === req.user.id) return res.status(400).json({ error: "You can't pay yourself." });

  if (req.user.kycStatus !== "VERIFIED" || !req.user.fundingSourceVerified)
    return res.status(403).json({ error: "Finish identity verification and link a bank before sending money." });
  if (!recipient.fundingSourceVerified)
    return res.status(400).json({ error: `${recipient.name} hasn't linked a verified bank account yet.` });

  const feeCents = computeFee(v.cents, feeParams());

  try {
    await checkVelocity(prisma, { userId: req.user.id, amountCents: v.cents });
  } catch (e) {
    if (e instanceof VelocityError) return res.status(429).json({ error: "You've hit a sending limit. Try again later or with a smaller amount." });
    throw e;
  }

  const { dwollaTransferUrl, dwollaTransferId, idempotencyKey } = await createTransfer({
    sourceFundingSourceUrl: req.user.fundingSourceUrl,
    destinationFundingSourceUrl: recipient.fundingSourceUrl,
    amountCents: v.cents,
    feeCents,
    feeChargeToCustomerUrl: feeCents > 0 ? req.user.dwollaCustomerUrl : undefined,
    idempotencyKey: newIdempotencyKey(),
  });

  await createTransferRecord({
    idempotencyKey, providerRef: dwollaTransferId, providerUrl: dwollaTransferUrl,
    senderId: req.user.id, recipientId: recipient.id, amountCents: v.cents, feeCents, note,
  });

  res.json({ user: publicUser(req.user), feeCents, amountCents: v.cents });
});

// ── request money (no Dwolla — just a note on the feed) ────
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

// Serve the built web app from the same origin (used on Replit). SPA fallback
// so client routes work on refresh. API + webhook are untouched.
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
