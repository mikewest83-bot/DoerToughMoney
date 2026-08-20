import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import "express-async-errors"; // route async throws reach the error handler below
import cors from "cors";
import rateLimit from "express-rate-limit";

import { register, login, googleAuth, registerWithGoogle, authRequired, publicUser } from "./auth.js";
import { googleConfigured } from "./google.js";
import {
  registrationOptions as passkeyRegOptions, registrationVerify as passkeyRegVerify,
  authenticationOptions as passkeyAuthOptions, authenticationVerify as passkeyAuthVerify,
  listCredentials as passkeyList,
} from "./webauthn.js";
import prisma, {
  getUserById, getUserByHandle, searchUsers,
} from "./db.js";
import { validateProductionConfig, plaidConfigured } from "./config.js";
import { validateAmount } from "./logic.js";
import {
  getGroup, listGroupsForUser, memberFor, createGroup, addMember, removeMember,
  addExpense, deleteExpense, recordSettlement, addRecurring, deactivateRecurring,
  shapeGroup, findOrCreatePairGroup,
  sendReminder, remindersForUser, markReminderSeen, lastRemindedMap,
} from "./groupsdb.js";
import { MAX_DAY_OF_MONTH } from "./groups.js";
import { startRecurringExpenseCron } from "./recurring.js";
import { idempotency } from "./idempotency.js";
import { createLinkToken, exchangePublicToken, removeItem as removePlaidItem } from "./plaid/link.js";
import { syncItem, syncAllForUser } from "./plaid/sync.js";
import { plaidWebhook } from "./plaid/webhook.js";
import {
  spendingByCategory, periodSummary, monthOverMonth, topNegotiableBills,
  totalAvailableCents, totalDebtCents, budgetStatus, goalProgress,
} from "./insights.js";
import { analyzeDeal, dealtoughConfigured } from "./dealtough.js";

validateProductionConfig();

const app = express();
app.set("trust proxy", 1); // behind Railway's proxy — needed for correct rate-limit IPs
app.use(cors({ origin: process.env.WEB_ORIGIN || "http://localhost:5173" }));

// Plaid webhook needs the raw body to verify the SHA-256 the signing JWT
// carries, so it's captured via express.json()'s verify hook rather than a
// separate express.raw() mount (Plaid signs the parsed-JSON body's hash, not
// the raw bytes the way Dwolla did).
app.post(
  "/webhooks/plaid",
  express.json({
    verify: (req, _res, buf) => { req.rawBodyForPlaid = buf; },
  }),
  plaidWebhook(prisma)
);

app.use(express.json());

// ── rate limiting ────────────────────────────────────────
const limit = (max, message) =>
  rateLimit({ windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false, message: { error: message } });

const apiLimiter = limit(120, "Too many requests. Give it a minute.");
const authLimiter = limit(12, "Too many attempts. Wait a minute and try again.");
// Bank linking and sync hit Plaid's own API, so they get a tighter budget
// than ordinary reads.
const plaidLimiter = limit(20, "Slow down a moment and try again.");
// Ledger writes don't move money but they do mutate shared state other people
// see, so they get their own budget rather than only the broad API limit.
const ledgerLimiter = limit(60, "Slow down a moment and try again.");

app.use("/api", apiLimiter);

// Public: lets the client know which optional features are wired up.
app.get("/api/config", (_req, res) => {
  res.json({
    googleEnabled: googleConfigured(),
    googleClientId: googleConfigured() ? process.env.GOOGLE_CLIENT_ID : null,
    plaidEnabled: plaidConfigured(),
    dealtoughEnabled: dealtoughConfigured(),
  });
});

// ── auth ─────────────────────────────────────────────────
app.post("/api/register", authLimiter, register);
app.post("/api/login", authLimiter, login);
app.post("/api/auth/google", authLimiter, googleAuth);
app.post("/api/register/google", authLimiter, registerWithGoogle);

// ── passkeys (Face ID / Touch ID) ────────────────────────
// Enrollment requires being signed in already; sign-in is public and
// usernameless — the credential ID the browser returns is how the request
// resolves to an account, so there's no user to gate it behind beforehand.
app.get("/api/webauthn/credentials", authRequired, passkeyList);
app.post("/api/webauthn/register/options", authRequired, passkeyRegOptions);
app.post("/api/webauthn/register/verify", authRequired, passkeyRegVerify);
app.post("/api/webauthn/login/options", authLimiter, passkeyAuthOptions);
app.post("/api/webauthn/login/verify", authLimiter, passkeyAuthVerify);

// ── me ───────────────────────────────────────────────────
app.get("/api/me", authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/users", authRequired, async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const users = (await searchUsers(q, req.user.id)).map((u) => ({ id: u.id, name: u.name, handle: u.handle }));
  res.json({ users });
});

// ── linked banks (Plaid) ──────────────────────────────────
app.post("/api/plaid/link-token", authRequired, plaidLimiter, async (req, res) => {
  if (!plaidConfigured()) return res.status(503).json({ error: "Bank linking isn't available right now." });
  // PLAID_WEBHOOK_URL should point at this service's own /webhooks/plaid,
  // e.g. https://<your-app>.up.railway.app/webhooks/plaid — set once the
  // service has a public domain, so Plaid can push updates instead of the
  // app relying solely on the manual /api/plaid/sync refresh.
  const linkToken = await createLinkToken(req.user.id, process.env.PLAID_WEBHOOK_URL);
  res.json({ linkToken });
});

app.post("/api/plaid/exchange", authRequired, plaidLimiter, idempotency, async (req, res) => {
  if (!plaidConfigured()) return res.status(503).json({ error: "Bank linking isn't
