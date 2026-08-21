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
import { computeSafeToSpendCents, assessPurchase } from "./affordability.js";
import { stripeConfigured, createCheckoutSession, createPortalSession, stripeWebhook } from "./stripe.js";

validateProductionConfig();

const app = express();
app.set("trust proxy", 1); // behind Railway's proxy — needed for correct rate-limit IPs
const allowedOrigins = new Set([process.env.WEB_ORIGIN, "http://localhost:5173", "http://127.0.0.1:5173"].filter(Boolean));
app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.has(origin)) return callback(null, true);
  return callback(new Error("Not allowed by CORS"));
} }));

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

// Stripe signs the raw request bytes, not a re-serialized JSON body (unlike
// the Plaid webhook above), so this has to run BEFORE express.json() ever
// touches the body — express.json() below would otherwise parse and discard
// the raw buffer stripeWebhook() needs to verify the signature.
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook());

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
// Checkout/portal calls hit Stripe's own API, so they get their own budget
// rather than the broad API limit.
const billingLimiter = limit(20, "Slow down a moment and try again.");

app.use("/api", apiLimiter);

// Public: lets the client know which optional features are wired up.
app.get("/api/config", (_req, res) => {
  res.json({
    googleEnabled: googleConfigured(),
    googleClientId: googleConfigured() ? process.env.GOOGLE_CLIENT_ID : null,
    plaidEnabled: plaidConfigured(),
    dealtoughEnabled: dealtoughConfigured(),
    stripeEnabled: stripeConfigured(),
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
  if (!plaidConfigured()) return res.status(503).json({ error: "Bank linking isn't available right now." });
  const { publicToken } = req.body || {};
  if (!publicToken) return res.status(400).json({ error: "Missing publicToken." });

  const { accessToken, plaidItemId, institutionId, institutionName } = await exchangePublicToken(publicToken);
  const item = await prisma.plaidItem.create({
    data: { userId: req.user.id, plaidItemId, accessToken, institutionId, institutionName },
  });

  // Pull the first batch of accounts/transactions right away so the UI has
  // something to show without waiting on the async webhook.
  const result = await syncItem(prisma, item).catch((e) => {
    console.error("[plaid] initial sync failed:", e?.response?.data || e.message);
    return null;
  });

  res.status(201).json({ plaidItemId: item.id, institutionName, synced: result });
});

app.get("/api/plaid/items", authRequired, async (req, res) => {
  const items = await prisma.plaidItem.findMany({
    where: { userId: req.user.id },
    select: { id: true, institutionName: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ items });
});

app.delete("/api/plaid/items/:id", authRequired, plaidLimiter, async (req, res) => {
  const item = await prisma.plaidItem.findUnique({ where: { id: req.params.id } });
  if (!item || item.userId !== req.user.id) return res.status(404).json({ error: "Not found." });
  await removePlaidItem(item.accessToken).catch((e) => console.error("[plaid] itemRemove failed:", e?.response?.data || e.message));
  await prisma.plaidItem.delete({ where: { id: item.id } }); // cascades to Account -> Transaction
  res.json({ ok: true });
});

app.post("/api/plaid/sync", authRequired, plaidLimiter, async (req, res) => {
  if (!plaidConfigured()) return res.status(503).json({ error: "Bank linking isn't available right now." });
  const results = await syncAllForUser(prisma, req.user.id);
  res.json({ results });
});

// ── accounts & balances ───────────────────────────────────
app.get("/api/accounts", authRequired, async (req, res) => {
  const accounts = await prisma.account.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "asc" } });
  res.json({
    accounts: accounts.map((a) => ({
      id: a.id, name: a.name, officialName: a.officialName, mask: a.mask,
      type: a.type, subtype: a.subtype,
      currentBalance: (a.currentBalanceCents ?? 0) / 100,
      availableBalance: a.availableBalanceCents != null ? a.availableBalanceCents / 100 : null,
    })),
    totalAvailable: totalAvailableCents(accounts) / 100,
    totalDebt: totalDebtCents(accounts) / 100,
  });
});

// ── transactions ──────────────────────────────────────────
app.get("/api/transactions", authRequired, async (req, res) => {
  const { from, to, category, limit: limitRaw } = req.query;
  const where = { userId: req.user.id };
  if (from || to) where.date = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
  if (category) where.category = category;

  const take = Math.min(Number.parseInt(limitRaw, 10) || 100, 500);
  const transactions = await prisma.transaction.findMany({ where, orderBy: { date: "desc" }, take });
  res.json({
    transactions: transactions.map((t) => ({
      id: t.id, accountId: t.accountId, amount: t.amountCents / 100, date: t.date,
      name: t.name, merchantName: t.merchantName, category: t.category, pending: t.pending, billId: t.billId,
    })),
  });
});

app.patch("/api/transactions/:id", authRequired, ledgerLimiter, async (req, res) => {
  const txn = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!txn || txn.userId !== req.user.id) return res.status(404).json({ error: "Not found." });

  const { category, billId } = req.body || {};
  const data = {};
  if (category !== undefined) data.category = category ? String(category).slice(0, 60) : null;
  if (billId !== undefined) {
    if (billId) {
      const bill = await prisma.bill.findUnique({ where: { id: billId } });
      if (!bill || bill.userId !== req.user.id) return res.status(400).json({ error: "That bill doesn't exist." });
    }
    data.billId = billId || null;
  }
  const updated = await prisma.transaction.update({ where: { id: txn.id }, data });
  res.json({ transaction: { id: updated.id, category: updated.category, billId: updated.billId } });
});

// ── bills ─────────────────────────────────────────────────
app.get("/api/bills", authRequired, async (req, res) => {
  const bills = await prisma.bill.findMany({ where: { userId: req.user.id }, orderBy: { amountCents: "desc" } });
  res.json({
    bills: bills.map((b) => ({
      id: b.id, name: b.name, category: b.category, amount: b.amountCents / 100,
      cadence: b.cadence, nextDueOn: b.nextDueOn, autoDetected: b.autoDetected, active: b.active,
    })),
    // The candidates worth pointing at DealTough first — biggest recurring
    // spend, so a percentage discount saves the most in real dollars.
    topNegotiable: topNegotiableBills(bills).slice(0, 5).map((b) => ({ id: b.id, name: b.name, amount: b.amountCents / 100 })),
  });
});

app.post("/api/bills", authRequired, ledgerLimiter, async (req, res) => {
  const { name, category, amount, cadence, nextDueOn } = req.body || {};
  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const trimmed = String(name || "").trim();
  if (!trimmed) return res.status(400).json({ error: "Give the bill a name." });

  const bill = await prisma.bill.create({
    data: {
      userId: req.user.id, name: trimmed.slice(0, 80), category: category ? String(category).slice(0, 60) : null,
      amountCents: v.cents,
      cadence: ["WEEKLY", "MONTHLY", "YEARLY"].includes(cadence) ? cadence : "UNKNOWN",
      nextDueOn: nextDueOn ? new Date(nextDueOn) : null,
    },
  });
  res.status(201).json({ bill: { id: bill.id, name: bill.name, amount: bill.amountCents / 100 } });
});

app.patch("/api/bills/:id", authRequired, ledgerLimiter, async (req, res) => {
  const bill = await prisma.bill.findUnique({ where: { id: req.params.id } });
  if (!bill || bill.userId !== req.user.id) return res.status(404).json({ error: "Not found." });

  const { name, category, amount, cadence, nextDueOn, active } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = String(name).trim().slice(0, 80);
  if (category !== undefined) data.category = category ? String(category).slice(0, 60) : null;
  if (amount !== undefined) {
    const v = validateAmount(amount);
    if (!v.ok) return res.status(400).json({ error: v.error });
    data.amountCents = v.cents;
  }
  if (cadence !== undefined && ["WEEKLY", "MONTHLY", "YEARLY", "UNKNOWN"].includes(cadence)) data.cadence = cadence;
  if (nextDueOn !== undefined) data.nextDueOn = nextDueOn ? new Date(nextDueOn) : null;
  if (active !== undefined) data.active = !!active;

  const updated = await prisma.bill.update({ where: { id: bill.id }, data });
  res.json({ bill: { id: updated.id, name: updated.name, amount: updated.amountCents / 100, active: updated.active } });
});

app.delete("/api/bills/:id", authRequired, async (req, res) => {
  const bill = await prisma.bill.findUnique({ where: { id: req.params.id } });
  if (!bill || bill.userId !== req.user.id) return res.status(404).json({ error: "Not found." });
  await prisma.bill.delete({ where: { id: bill.id } });
  res.json({ ok: true });
});

// ── budgets ───────────────────────────────────────────────
app.get("/api/budgets", authRequired, async (req, res) => {
  const budgets = await prisma.budget.findMany({ where: { userId: req.user.id } });
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const spentByCategory = spendingByCategory(
    await prisma.transaction.findMany({ where: { userId: req.user.id, date: { gte: monthStart } } })
  );
  const spentMap = Object.fromEntries(spentByCategory.map((c) => [c.category, c.cents]));

  res.json({
    budgets: budgets.map((b) => {
      const status = budgetStatus(b, spentMap[b.category] || 0);
      return {
        id: b.id, category: b.category, monthlyLimit: b.monthlyLimitCents / 100,
        spent: status.spentCents / 100, remaining: status.remainingCents / 100,
        overBudget: status.overBudget, percentUsed: status.percentUsed,
      };
    }),
  });
});

// Upsert by category — one budget per category per user.
app.post("/api/budgets", authRequired, ledgerLimiter, async (req, res) => {
  const { category, monthlyLimit } = req.body || {};
  const trimmed = String(category || "").trim();
  if (!trimmed) return res.status(400).json({ error: "Choose a category." });
  const v = validateAmount(monthlyLimit);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const budget = await prisma.budget.upsert({
    where: { userId_category: { userId: req.user.id, category: trimmed } },
    create: { userId: req.user.id, category: trimmed, monthlyLimitCents: v.cents },
    update: { monthlyLimitCents: v.cents },
  });
  res.status(201).json({ budget: { id: budget.id, category: budget.category, monthlyLimit: budget.monthlyLimitCents / 100 } });
});

app.delete("/api/budgets/:id", authRequired, async (req, res) => {
  const budget = await prisma.budget.findUnique({ where: { id: req.params.id } });
  if (!budget || budget.userId !== req.user.id) return res.status(404).json({ error: "Not found." });
  await prisma.budget.delete({ where: { id: budget.id } });
  res.json({ ok: true });
});

// ── goals ─────────────────────────────────────────────────
app.get("/api/goals", authRequired, async (req, res) => {
  const goals = await prisma.goal.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "asc" } });
  res.json({
    goals: goals.map((g) => ({
      id: g.id, name: g.name, target: g.targetCents / 100, current: g.currentCents / 100,
      targetDate: g.targetDate, percent: goalProgress(g),
    })),
  });
});

app.post("/api/goals", authRequired, ledgerLimiter, async (req, res) => {
  const { name, target, targetDate } = req.body || {};
  const trimmed = String(name || "").trim();
  if (!trimmed) return res.status(400).json({ error: "Give the goal a name." });
  const v = validateAmount(target);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const goal = await prisma.goal.create({
    data: { userId: req.user.id, name: trimmed.slice(0, 80), targetCents: v.cents, targetDate: targetDate ? new Date(targetDate) : null },
  });
  res.status(201).json({ goal: { id: goal.id, name: goal.name, target: goal.targetCents / 100 } });
});

app.patch("/api/goals/:id", authRequired, ledgerLimiter, async (req, res) => {
  const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!goal || goal.userId !== req.user.id) return res.status(404).json({ error: "Not found." });

  const { name, target, current, targetDate } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = String(name).trim().slice(0, 80);
  if (target !== undefined) {
    const v = validateAmount(target);
    if (!v.ok) return res.status(400).json({ error: v.error });
    data.targetCents = v.cents;
  }
  if (current !== undefined) {
    const c = Math.round(Number(current) * 100);
    if (!Number.isFinite(c) || c < 0) return res.status(400).json({ error: "Enter a valid amount." });
    data.currentCents = c;
  }
  if (targetDate !== undefined) data.targetDate = targetDate ? new Date(targetDate) : null;

  const updated = await prisma.goal.update({ where: { id: goal.id }, data });
  res.json({ goal: { id: updated.id, name: updated.name, current: updated.currentCents / 100, target: updated.targetCents / 100 } });
});

app.delete("/api/goals/:id", authRequired, async (req, res) => {
  const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
  if (!goal || goal.userId !== req.user.id) return res.status(404).json({ error: "Not found." });
  await prisma.goal.delete({ where: { id: goal.id } });
  res.json({ ok: true });
});

// ── insights ──────────────────────────────────────────────
// "What's my financial trajectory": this month vs last month by category,
// plus which bills are the best DealTough candidates.
app.get("/api/insights", authRequired, async (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [currentTxns, previousTxns, bills] = await Promise.all([
    prisma.transaction.findMany({ where: { userId: req.user.id, date: { gte: monthStart } } }),
    prisma.transaction.findMany({ where: { userId: req.user.id, date: { gte: prevMonthStart, lt: monthStart } } }),
    prisma.bill.findMany({ where: { userId: req.user.id } }),
  ]);

  const summary = periodSummary(currentTxns);
  res.json({
    thisMonth: { spend: summary.spendCents / 100, income: summary.incomeCents / 100, net: summary.netCents / 100 },
    byCategory: spendingByCategory(currentTxns).map((c) => ({ category: c.category, amount: c.cents / 100 })),
    monthOverMonth: monthOverMonth(currentTxns, previousTxns)
      .slice(0, 10)
      .map((c) => ({ category: c.category, current: c.currentCents / 100, previous: c.previousCents / 100, delta: c.deltaCents / 100 })),
    topNegotiableBills: topNegotiableBills(bills).slice(0, 5).map((b) => ({ id: b.id, name: b.name, amount: b.amountCents / 100 })),
  });
});

// ── DealTough integration ────────────────────────────────
// "Should I buy this?" for a one-time purchase. Calls out to DealTough's own
// deployment (see dealtough.js) — DoerToughMoney doesn't run this engine
// itself. Recurring-bill negotiation isn't wired up yet; see dealtough.js.
app.post("/api/dealtough/analyze", authRequired, ledgerLimiter, async (req, res) => {
  if (!dealtoughConfigured()) return res.status(503).json({ error: "DealTough isn't connected right now." });

  let deal;
  try {
    deal = await analyzeDeal(req.body || {});
  } catch (e) {
    return res.status(400).json({ error: e.message || "Couldn't analyze that." });
  }

  // Affordability is a separate, best-effort lookup against the user's own
  // linked accounts/bills (see affordability.js) — wrapped in its own
  // try/catch so a DB hiccup here can't take down a deal verdict DealTough
  // already returned successfully. `affordability: null` just means unknown.
  let affordability = null;
  try {
    const [accounts, bills] = await Promise.all([
      prisma.account.findMany({ where: { userId: req.user.id } }),
      prisma.bill.findMany({ where: { userId: req.user.id } }),
    ]);
    const safeToSpendCents = computeSafeToSpendCents(accounts, bills);
    affordability = assessPurchase(deal, req.body?.askingPrice, safeToSpendCents);
  } catch (e) {
    console.error("[dealtough] affordability lookup failed:", e.message);
  }

  res.json({ deal, affordability });
});

// ── billing (Stripe subscriptions) ───────────────────────
// Card billing only — same boundary as everywhere else in this app. Actual
// subscription state lives on the User row, kept in sync by the webhook
// above; these routes just start/manage that relationship on Stripe's side.
app.get("/api/billing/status", authRequired, (req, res) => {
  res.json({
    tier: req.user.subscriptionTier,
    status: req.user.subscriptionStatus,
    currentPeriodEnd: req.user.currentPeriodEnd,
  });
});

app.post("/api/billing/checkout", authRequired, billingLimiter, async (req, res) => {
  if (!stripeConfigured()) return res.status(503).json({ error: "Billing isn't available right now." });
  const url = await createCheckoutSession(req.user, {
    successUrl: `${process.env.WEB_ORIGIN}/?billing=success`,
    cancelUrl: `${process.env.WEB_ORIGIN}/?billing=cancel`,
  });
  res.json({ url });
});

app.post("/api/billing/portal", authRequired, billingLimiter, async (req, res) => {
  if (!stripeConfigured()) return res.status(503).json({ error: "Billing isn't available right now." });
  try {
    const url = await createPortalSession(req.user, { returnUrl: `${process.env.WEB_ORIGIN}/` });
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: e.message || "Couldn't open billing management." });
  }
});

// ── shared expenses ──────────────────────────────────────
// Debts are tracked data, not custody — DoerToughMoney never holds or moves
// anyone else's money. Settling up records a cash payoff, not a transfer.

// Loads the group and asserts the caller belongs to it. Every group route goes
// through this, so membership can't be forgotten on one endpoint.
async function requireMembership(req, res) {
  const group = await getGroup(req.params.id);
  if (!group) { res.status(404).json({ error: "Group not found." }); return null; }
  const me = memberFor(group, req.user.id);
  if (!me) { res.status(403).json({ error: "You're not a member of that group." }); return null; }
  return { group, me };
}

app.get("/api/groups", authRequired, async (req, res) => {
  const groups = await listGroupsForUser(req.user.id);
  res.json({ groups: groups.map((g) => shapeGroup(g, req.user.id)) });
});

app.post("/api/groups", authRequired, ledgerLimiter, async (req, res) => {
  const { name, type } = req.body || {};
  const trimmed = String(name || "").trim();
  if (trimmed.length < 2) return res.status(400).json({ error: "Give the group a name." });
  const allowed = ["HOUSEHOLD", "TRIP", "TEAM", "OTHER"];
  const group = await createGroup({
    name: trimmed.slice(0, 60),
    type: allowed.includes(type) ? type : "HOUSEHOLD",
    createdById: req.user.id,
  });
  res.status(201).json({ group: shapeGroup(group, req.user.id) });
});

app.get("/api/groups/:id", authRequired, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  // Cooldown state so the UI can show "Reminded" instead of a button that fails.
  const lastReminded = await lastRemindedMap(ctx.me.id);
  res.json({ group: shapeGroup(ctx.group, req.user.id, { lastReminded }) });
});

// Add by handle (they're already on DoerToughMoney) or by email (creates a
// placeholder that holds their share until they sign up).
app.post("/api/groups/:id/members", authRequired, ledgerLimiter, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  const { handle, email, name } = req.body || {};

  if (handle) {
    const user = await getUserByHandle(String(handle).startsWith("@") ? handle : `@${handle}`);
    if (!user) return res.status(404).json({ error: "No one with that handle." });
    if (memberFor(ctx.group, user.id)) return res.status(409).json({ error: `${user.name} is already in this group.` });
    await addMember(ctx.group.id, { userId: user.id });
  } else if (email) {
    const normalized = String(email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return res.status(400).json({ error: "Enter a valid email address." });
    // If they already have an account, link them directly instead of leaving a
    // placeholder they'd never be matched to.
    const existing = await prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      if (memberFor(ctx.group, existing.id)) return res.status(409).json({ error: `${existing.name} is already in this group.` });
      await addMember(ctx.group.id, { userId: existing.id });
    } else {
      if (ctx.group.members.some((m) => m.inviteEmail === normalized)) return res.status(409).json({ error: "That person has already been invited." });
      await addMember(ctx.group.id, { inviteEmail: normalized, inviteName: name });
    }
  } else {
    return res.status(400).json({ error: "Provide a handle or an email address." });
  }

  res.status(201).json({ group: shapeGroup(await getGroup(ctx.group.id), req.user.id) });
});

app.delete("/api/groups/:id/members/:memberId", authRequired, ledgerLimiter, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  const target = ctx.group.members.find((m) => m.id === req.params.memberId);
  if (!target) return res.status(404).json({ error: "That person isn't in this group." });

  // Removing others is limited to the group's creator; everyone else can only
  // remove themselves (leave).
  const isCreator = ctx.group.createdById === req.user.id;
  const isSelf = target.id === ctx.me.id;
  if (!isCreator && !isSelf)
    return res.status(403).json({ error: "Only the person who created this group can remove others." });
  if (isCreator && isSelf && ctx.group.members.length > 1)
    return res.status(409).json({ error: "You created this group — remove the others first, or settle up and delete it." });

  const result = await removeMember(ctx.group.id, req.params.memberId);
  if (!result.removed) return res.status(409).json({ error: result.reason });
  res.json({ group: shapeGroup(await getGroup(ctx.group.id), req.user.id) });
});

// Idempotent because a duplicate expense silently corrupts every balance in the
// group.
app.post("/api/groups/:id/expenses", authRequired, ledgerLimiter, idempotency, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  const { amount, description, paidByMemberId, splitMode, shares, splitMemberIds, incurredOn } = req.body || {};

  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const desc = String(description || "").trim();
  if (!desc) return res.status(400).json({ error: "What was the expense for?" });

  const memberIds = ctx.group.members.map((m) => m.id);
  const payer = paidByMemberId || ctx.me.id;
  if (!memberIds.includes(payer)) return res.status(400).json({ error: "Whoever paid must be in the group." });

  // Default to splitting across everyone; allow a subset (not everyone shares
  // every expense) but only members of this group.
  const splitAcross = Array.isArray(splitMemberIds) && splitMemberIds.length ? splitMemberIds : memberIds;
  if (splitAcross.some((id) => !memberIds.includes(id)))
    return res.status(400).json({ error: "Can only split between members of this group." });
  if (splitMode === "EXACT" && (!Array.isArray(shares) || shares.some((s) => !memberIds.includes(s.memberId))))
    return res.status(400).json({ error: "Can only split between members of this group." });

  const result = await addExpense({
    groupId: ctx.group.id, paidByMemberId: payer, amountCents: v.cents,
    description: desc.slice(0, 140), splitMode, splitMemberIds: splitAcross,
    shares: splitMode === "EXACT" ? shares.map((s) => ({ memberId: s.memberId, shareCents: Math.round(Number(s.amount) * 100) })) : undefined,
    createdById: req.user.id, incurredOn,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });

  res.status(201).json({ group: shapeGroup(await getGroup(ctx.group.id), req.user.id) });
});

app.delete("/api/groups/:id/expenses/:expenseId", authRequired, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  const expense = ctx.group.expenses.find((e) => e.id === req.params.expenseId);
  if (!expense) return res.status(404).json({ error: "Expense not found in this group." });

  // Only whoever created it, whoever's marked as having paid it, or the
  // group's creator can delete it — any member being able to erase anyone
  // else's recorded expense was a standing authorization gap.
  const isCreator = ctx.group.createdById === req.user.id;
  const isExpenseCreator = expense.createdById === req.user.id;
  const isPayer = expense.paidByMemberId === ctx.me.id;
  if (!isCreator && !isExpenseCreator && !isPayer)
    return res.status(403).json({ error: "Only whoever added or paid this expense (or the group's creator) can delete it." });

  await deleteExpense(req.params.expenseId);
  res.json({ group: shapeGroup(await getGroup(ctx.group.id), req.user.id) });
});

// Rent, utilities, subscriptions — so nobody re-enters them monthly.
app.post("/api/groups/:id/recurring", authRequired, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  const { amount, description, paidByMemberId, interval, dayOfMonth, dayOfWeek } = req.body || {};

  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const desc = String(description || "").trim();
  if (!desc) return res.status(400).json({ error: "What is this recurring charge for?" });
  if (!["WEEKLY", "MONTHLY"].includes(interval)) return res.status(400).json({ error: "Choose weekly or monthly." });

  const payer = paidByMemberId || ctx.me.id;
  if (!ctx.group.members.some((m) => m.id === payer)) return res.status(400).json({ error: "Whoever pays must be in the group." });

  await addRecurring({
    groupId: ctx.group.id, paidByMemberId: payer, amountCents: v.cents,
    description: desc.slice(0, 140), interval,
    // Capped so "the 31st" still fires in February rather than silently skipping.
    dayOfMonth: interval === "MONTHLY" ? Math.min(Math.max(Number(dayOfMonth) || 1, 1), MAX_DAY_OF_MONTH) : null,
    dayOfWeek: interval === "WEEKLY" ? Math.min(Math.max(Number(dayOfWeek) || 0, 0), 6) : null,
  });
  res.status(201).json({ group: shapeGroup(await getGroup(ctx.group.id), req.user.id) });
});

app.delete("/api/groups/:id/recurring/:recurringId", authRequired, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  if (!ctx.group.recurring.some((r) => r.id === req.params.recurringId))
    return res.status(404).json({ error: "Recurring expense not found in this group." });
  await deactivateRecurring(req.params.recurringId);
  res.json({ group: shapeGroup(await getGroup(ctx.group.id), req.user.id) });
});

// Square up. DoerToughMoney doesn't move money on anyone's behalf — this
// records that two people settled in cash (or however they actually paid
// each other), it doesn't initiate a transfer.
app.post("/api/groups/:id/settle", authRequired, ledgerLimiter, idempotency, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  const { toMemberId, amount } = req.body || {};

  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const target = ctx.group.members.find((m) => m.id === toMemberId);
  if (!target) return res.status(404).json({ error: "That person isn't in this group." });
  if (target.id === ctx.me.id) return res.status(400).json({ error: "You can't settle with yourself." });

  await recordSettlement({ groupId: ctx.group.id, fromMemberId: ctx.me.id, toMemberId: target.id, amountCents: v.cents });
  res.json({ group: shapeGroup(await getGroup(ctx.group.id), req.user.id) });
});

// ── reminders ────────────────────────────────────────────
// Nudging is in-app only: DoerToughMoney sends nothing outbound on a user's
// behalf. The cooldown in groups.js is what keeps this from becoming a
// harassment tool.
app.post("/api/groups/:id/remind", authRequired, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  const { toMemberId, note } = req.body || {};
  if (!toMemberId) return res.status(400).json({ error: "Who do you want to remind?" });

  const result = await sendReminder({ group: ctx.group, fromMemberId: ctx.me.id, toMemberId, note });
  if (!result.ok) return res.status(result.status).json({ error: result.error });

  const group = await getGroup(ctx.group.id);
  res.status(201).json({ group: shapeGroup(group, req.user.id, { lastReminded: await lastRemindedMap(ctx.me.id) }) });
});

// What's waiting for me, so a nudge actually surfaces on the other side.
app.get("/api/reminders", authRequired, async (req, res) => {
  res.json({ reminders: await remindersForUser(req.user.id) });
});

app.post("/api/reminders/:reminderId/seen", authRequired, async (req, res) => {
  const result = await markReminderSeen(req.params.reminderId, req.user.id);
  if (!result.ok) return res.status(404).json({ error: "Reminder not found." });
  res.json({ ok: true });
});

// Quick 1:1 "I covered this, you owe me half" — no group setup required. Runs
// on the same engine via an implicit pair group, so the debt shows up in the
// same balances and settles the same way. No money moves — this is bookkeeping,
// like every other shared-expense route.
app.post("/api/split", authRequired, ledgerLimiter, idempotency, async (req, res) => {
  const { handle, amount, description, theirShare } = req.body || {};
  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const desc = String(description || "").trim();
  if (!desc) return res.status(400).json({ error: "What was it for?" });

  const other = await getUserByHandle(String(handle || "").startsWith("@") ? handle : `@${handle}`);
  if (!other) return res.status(404).json({ error: "No one with that handle." });
  if (other.id === req.user.id) return res.status(400).json({ error: "You can't split with yourself." });

  const group = await findOrCreatePairGroup(req.user, other);
  const mine = memberFor(group, req.user.id);
  const theirs = memberFor(group, other.id);

  // Default to an even split; theirShare lets the caller say "you owe all of it"
  // or any other amount.
  let shares;
  if (theirShare !== undefined && theirShare !== null && theirShare !== "") {
    const t = validateAmount(theirShare);
    if (!t.ok) return res.status(400).json({ error: t.error });
    if (t.cents > v.cents) return res.status(400).json({ error: "Their share can't exceed the total." });
    shares = [{ memberId: theirs.id, shareCents: t.cents }, { memberId: mine.id, shareCents: v.cents - t.cents }];
  }

  const result = await addExpense({
    groupId: group.id, paidByMemberId: mine.id, amountCents: v.cents,
    description: desc.slice(0, 140),
    splitMode: shares ? "EXACT" : "EQUAL",
    splitMemberIds: [mine.id, theirs.id], shares,
    createdById: req.user.id,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });

  res.status(201).json({ group: shapeGroup(await getGroup(group.id), req.user.id) });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Serve the built web app from the same origin (used on Railway/Replit). SPA
// fallback so client routes work on refresh — anything that isn't /api/* and
// isn't a real static file falls back to index.html so React Router can
// handle it client-side. API + webhooks are untouched.
//
// This serves whenever a real build is present at web/dist/index.html,
// rather than gating on `if (process.env.SERVE_WEB)` — that was a truthy
// check, so a SERVE_WEB variable set to an empty string (easy to do by
// accident in Railway's dashboard) silently skipped this whole block with
// no error, which is what caused "Cannot GET /" in production even though
// the build itself was fine. Set SERVE_WEB=false to explicitly opt out
// (e.g. if the frontend is ever served from a separate service instead).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(__dirname, "../web/dist");
const webIndex = path.join(webDist, "index.html");
const serveWebDisabled = process.env.SERVE_WEB === "false";

if (!serveWebDisabled && fs.existsSync(webIndex)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(webIndex));
  console.log(`[web] serving built frontend from ${webDist}`);
} else if (!serveWebDisabled) {
  console.warn(`[web] no build found at ${webIndex} — "npm run build" should produce web/dist before start. GET / will 404 until it does.`);
}

// Anything a route throws lands here as clean JSON instead of a hung request.
app.use((err, _req, res, _next) => {
  if (res.headersSent) return;
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

// ── background jobs ──────────────────────────────────────
// Assumes a single instance (numReplicas: 1). If this service is ever scaled
// out, move this to a dedicated worker or add a distributed lock, or every
// replica will run the same sweep concurrently.
function startBackgroundJobs() {
  if (process.env.DISABLE_CRONS) return;
  startRecurringExpenseCron();
  console.log("[jobs] recurring shared-expense sweep scheduled");
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`DoerToughMoney server on :${PORT}`);
  startBackgroundJobs();
});

export default app;
