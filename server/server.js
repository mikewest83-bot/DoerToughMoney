import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import "express-async-errors"; // route async throws reach the error handler below
import cors from "cors";
import rateLimit from "express-rate-limit";

import { register, login, googleAuth, registerWithGoogle, verifyIdentity, authRequired, publicUser } from "./auth.js";
import { googleConfigured } from "./google.js";
import {
  registrationOptions as passkeyRegOptions, registrationVerify as passkeyRegVerify,
  authenticationOptions as passkeyAuthOptions, authenticationVerify as passkeyAuthVerify,
  listCredentials as passkeyList,
} from "./webauthn.js";
import prisma, {
  getUserById, getUserByHandle, searchUsers, feedForUser, logRequest,
  setFundingSource, setFundingSourceVerified, setKycStatusByCustomerUrlSuffix,
} from "./db.js";
import {
  dwollaWebhook, addBankManual, initiateMicroDeposits, verifyMicroDeposits,
  startReconcileCron, startDisputeDeadlineCron, issueProvisionalCredit,
  fileDispute, makeCreditFlows, getFundingSourceChannels, supportsInstant,
  createExchangeSession, getSessionToken, createExchange, addBankViaExchange,
} from "./dwolla/index.js";
import { idempotency } from "./idempotency.js";
import { validateAmount, shapeTxn } from "./logic.js";
import {
  validateProductionConfig, feeParams, dwollaConfigured,
  expediteFeeParams, expediteOffered, instantLinkEnabled,
} from "./config.js";
import { sendMoney, PaymentError, transferBlockedReason, canSendInstantly } from "./payments.js";
import {
  getGroup, listGroupsForUser, memberFor, createGroup, addMember, removeMember,
  addExpense, deleteExpense, recordSettlement, addRecurring, deactivateRecurring,
  shapeGroup, findOrCreatePairGroup,
  sendReminder, remindersForUser, markReminderSeen, lastRemindedMap,
} from "./groupsdb.js";
import { MAX_DAY_OF_MONTH } from "./groups.js";
import { startRecurringExpenseCron } from "./recurring.js";

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
    onReauthRequired: async (exchangeId) => {
      // The user's bank connection needs re-authentication; their payments will
      // fail until they relink. No user-facing prompt yet — see README.
      console.error(`[open-banking] REAUTH REQUIRED for exchange ${exchangeId} — user must reconnect their bank.`);
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
// Ledger writes don't move money but they do mutate shared state other people
// see, so they get their own budget rather than only the broad API limit.
const ledgerLimiter = limit(60, "Slow down a moment and try again.");

app.use("/api", apiLimiter);

// Public: lets the client preview fees before a payment.
app.get("/api/config", (_req, res) => {
  const { bps, flatCents, capCents } = feeParams();
  const ex = expediteFeeParams();
  res.json({
    feeBps: bps, feeFlatCents: flatCents, feeCapCents: Number.isFinite(capCents) ? capCents : null,
    expediteOffered: expediteOffered(),
    expediteFeeBps: ex.bps, expediteFeeFlatCents: ex.flatCents,
    expediteFeeCapCents: Number.isFinite(ex.capCents) ? ex.capCents : null,
    // Lets the client lead with instant bank linking instead of the slow
    // manual routing/account form.
    instantLinkEnabled: instantLinkEnabled(),
    // Gates the "Sign in with Google" button — no point rendering it before
    // GOOGLE_CLIENT_ID is configured.
    googleEnabled: googleConfigured(),
    googleClientId: googleConfigured() ? process.env.GOOGLE_CLIENT_ID : null,
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

app.get("/api/feed", authRequired, async (req, res) => {
  const rows = (await feedForUser(req.user.id)).map((t) => shapeTxn(t, req.user.id));
  res.json({ feed: rows });
});

app.get("/api/users", authRequired, async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const users = (await searchUsers(q, req.user.id)).map((u) => ({
    id: u.id, name: u.name, handle: u.handle,
    canReceive: u.fundingSourceVerified,
    // Drives the express option's copy: only claim "instant" when the transfer
    // can genuinely ride RTP, otherwise express is same-business-day.
    instantEligible: canSendInstantly(u),
  }));
  res.json({ users });
});

// ── complete identity verification (pre-migration accounts) ──
app.post("/api/verify-identity", authRequired, moneyLimiter, verifyIdentity);

// ── link a bank instantly (Dwolla Open Banking / Plaid IAV) ──
// Two calls: start a session to get a Link token for the browser, then hand
// back what Link returns. The funding source is verified on creation, so
// there's no micro-deposit wait and the user can send money right away.
app.post("/api/bank/link/start", authRequired, moneyLimiter, async (req, res) => {
  if (!instantLinkEnabled()) return res.status(503).json({ error: "Instant bank linking isn't available right now." });
  if (!req.user.dwollaCustomerUrl) return res.status(400).json({ error: "Finish identity verification first." });

  // Sessions are single-use, so every attempt starts a fresh one.
  try {
    const sessionUrl = await createExchangeSession(req.user.dwollaCustomerUrl);
    res.json({ linkToken: await getSessionToken(sessionUrl) });
  } catch (e) {
    // Open Banking scopes not granted on this Dwolla account yet — tell the
    // client plainly so it can fall back to manual entry instead of 500ing.
    if (e?.body?.code === "InvalidScope" || e?.status === 401) {
      console.error("[open-banking] exchange session rejected — Open Banking scopes are not enabled on this Dwolla account.");
      return res.status(503).json({ error: "Instant bank linking isn't available yet. Please enter your account details instead." });
    }
    throw e;
  }
});

app.post("/api/bank/link/complete", authRequired, moneyLimiter, idempotency, async (req, res) => {
  if (!instantLinkEnabled()) return res.status(503).json({ error: "Instant bank linking isn't available right now." });
  const { publicToken, bankAccountType, name } = req.body || {};
  if (!publicToken) return res.status(400).json({ error: "Bank connection was incomplete. Please try again." });
  if (!req.user.dwollaCustomerUrl) return res.status(400).json({ error: "Finish identity verification first." });

  const exchangeUrl = await createExchange(req.user.dwollaCustomerUrl, publicToken);
  const fundingSourceUrl = await addBankViaExchange(req.user.dwollaCustomerUrl, exchangeUrl, {
    bankAccountType: bankAccountType === "savings" ? "savings" : "checking",
    name: String(name || "Bank").slice(0, 50),
  });

  // Verified on creation — record it as such, along with the processing
  // channels that decide whether express payments here can ride Instant Payments.
  const channels = await getFundingSourceChannels(fundingSourceUrl).catch(() => ["ach"]);
  await setFundingSource(req.user.id, fundingSourceUrl);
  await setFundingSourceVerified(req.user.id, channels);
  res.json({ user: publicUser(await getUserById(req.user.id)) });
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
  // Record which processing channels this bank supports — it decides whether
  // express payments to this user can ride Instant Payments or Same Day ACH.
  const channels = await getFundingSourceChannels(req.user.fundingSourceUrl).catch(() => ["ach"]);
  await setFundingSourceVerified(req.user.id, channels);
  res.json({ user: publicUser(await getUserById(req.user.id)) });
});

// ── pay (real bank-to-bank transfer via Dwolla) ─────────────
app.post("/api/pay", authRequired, moneyLimiter, idempotency, async (req, res) => {
  const { handle, amount, note, speed: requestedSpeed } = req.body || {};
  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const recipient = await getUserByHandle(handle);
  if (!recipient) return res.status(404).json({ error: "No one with that handle." });

  const result = await sendMoney({
    sender: req.user, recipient, cents: v.cents, note, speed: requestedSpeed,
  });

  res.json({
    user: publicUser(req.user),
    feeCents: result.feeCents, expediteFeeCents: result.expediteFeeCents,
    amountCents: v.cents, speed: result.speed, usedInstant: result.usedInstant,
  });
});

// ── shared expenses ──────────────────────────────────────
// Debts are tracked data, not custody. Tracking needs no verification at all;
// only settling with real money does — so a household can start the day it
// signs up and verify later.

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

// Add by handle (they're already on even) or by email (creates a placeholder
// that holds their share until they sign up).
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

  // Anyone could previously remove anyone. Removing others is limited to the
  // group's creator; everyone else can only remove themselves (leave).
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
// group — the same reason the money routes carry it, even though no money moves.
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
  if (!ctx.group.expenses.some((e) => e.id === req.params.expenseId))
    return res.status(404).json({ error: "Expense not found in this group." });
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

// Square up. A real bank transfer when both sides are verified, otherwise a
// record that they settled in cash — the ledger stays usable either way.
app.post("/api/groups/:id/settle", authRequired, moneyLimiter, idempotency, async (req, res) => {
  const ctx = await requireMembership(req, res);
  if (!ctx) return;
  const { toMemberId, amount, method = "transfer", speed } = req.body || {};

  const v = validateAmount(amount);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const target = ctx.group.members.find((m) => m.id === toMemberId);
  if (!target) return res.status(404).json({ error: "That person isn't in this group." });
  if (target.id === ctx.me.id) return res.status(400).json({ error: "You can't settle with yourself." });

  if (method === "cash") {
    await recordSettlement({ groupId: ctx.group.id, fromMemberId: ctx.me.id, toMemberId: target.id, amountCents: v.cents });
    return res.json({ group: shapeGroup(await getGroup(ctx.group.id), req.user.id), settledInCash: true });
  }

  if (!target.userId) return res.status(400).json({ error: `${target.inviteName || "They"} hasn't joined even yet — record it as cash for now.` });
  const recipient = await getUserById(target.userId);
  const blocked = transferBlockedReason(req.user, recipient);
  if (blocked) return res.status(400).json({ error: `${blocked} You can record this as settled in cash instead.` });

  // Settling a shared expense is moving money you already owe, so the platform
  // fee doesn't apply — only the optional express upgrade the payer chose.
  const result = await sendMoney({
    sender: req.user, recipient, cents: v.cents,
    note: `Settled up — ${ctx.group.name}`, speed, chargeFees: false,
  });
  await recordSettlement({
    groupId: ctx.group.id, fromMemberId: ctx.me.id, toMemberId: target.id,
    amountCents: v.cents, transferId: result.transfer.id,
  });

  res.json({
    group: shapeGroup(await getGroup(ctx.group.id), req.user.id),
    expediteFeeCents: result.expediteFeeCents, speed: result.speed, usedInstant: result.usedInstant,
  });
});

// ── reminders ────────────────────────────────────────────
// Nudging is in-app only: even sends nothing outbound on a user's behalf. The
// cooldown in groups.js is what keeps this from becoming a harassment tool.
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
// same balances and settles the same way.
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

// ── disputes (Reg E) ─────────────────────────────────────
// File a dispute on a transfer you were party to. The 10-business-day
// investigation clock starts here; the daily sweep enforces the deadlines.
app.post("/api/disputes", authRequired, moneyLimiter, idempotency, async (req, res) => {
  const { transferId, reason } = req.body || {};
  if (!transferId) return res.status(400).json({ error: "Which payment is this about?" });
  const trimmedReason = String(reason || "").trim();
  if (trimmedReason.length < 3) return res.status(400).json({ error: "Tell us briefly what went wrong." });

  const transfer = await prisma.transfer.findUnique({ where: { id: transferId } });
  if (!transfer) return res.status(404).json({ error: "Payment not found." });
  if (transfer.senderId !== req.user.id && transfer.recipientId !== req.user.id)
    return res.status(403).json({ error: "That isn't your payment." });

  const already = await prisma.dispute.findFirst({
    where: { transferId, userId: req.user.id, status: { notIn: ["RESOLVED_UPHELD", "RESOLVED_DENIED"] } },
  });
  if (already) return res.status(409).json({ error: "You already have an open dispute on this payment." });

  const dispute = await fileDispute(prisma, {
    transferId,
    userId: req.user.id,
    amountCents: transfer.amountCents,
    reason: trimmedReason.slice(0, 500),
  });
  res.status(201).json({ dispute: shapeDispute(dispute) });
});

app.get("/api/disputes", authRequired, async (req, res) => {
  const disputes = await prisma.dispute.findMany({
    where: { userId: req.user.id },
    orderBy: { filedAt: "desc" },
    take: 50,
  });
  res.json({ disputes: disputes.map(shapeDispute) });
});

const shapeDispute = (d) => ({
  id: d.id, transferId: d.transferId, status: d.status,
  amount: d.amountCents / 100, reason: d.reason,
  filedAt: d.filedAt, resolvedAt: d.resolvedAt, resolutionNote: d.resolutionNote,
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
  if (res.headersSent) return;
  // Expected refusals (not enough verification, over a limit) carry their own
  // status and a message meant for the user; only log the unexpected ones.
  if (err instanceof PaymentError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

// ── background jobs ──────────────────────────────────────
// Both crons assume a single instance (numReplicas: 1). If this service is
// ever scaled out, move them to a dedicated worker or add a distributed lock,
// or every replica will run the same sweep concurrently.
function startBackgroundJobs() {
  if (process.env.DISABLE_CRONS) return;

  // Recurring shared expenses need no Dwolla involvement — they're bookkeeping,
  // so this runs even when payments aren't configured.
  startRecurringExpenseCron();

  if (!dwollaConfigured()) {
    console.warn("[jobs] Dwolla not configured — reconciliation and dispute sweeps are disabled.");
    return;
  }

  // Hourly: catch transfers whose webhook was missed or misrouted.
  startReconcileCron(prisma, {
    onDrift: async (drifts) => {
      // No alerting integration yet — this is the hook for Slack/PagerDuty.
      console.error("[dwolla] LEDGER DRIFT", JSON.stringify(drifts));
    },
  });

  // Daily: enforce Reg E deadlines. Auto-issuing provisional credit needs a
  // platform balance to pay from; without it we can only alert, since issuing
  // credit we can't fund would record a credit that never actually moved.
  let flows = null;
  if (process.env.PLATFORM_BALANCE_FS_URL) {
    flows = makeCreditFlows({ prisma, platformBalanceFundingSourceUrl: process.env.PLATFORM_BALANCE_FS_URL });
  } else {
    console.warn("[reg-e] PLATFORM_BALANCE_FS_URL not set — provisional credit will be flagged for manual action, not auto-issued.");
  }

  startDisputeDeadlineCron(prisma, {
    onProvisionalCreditDue: async (dispute) => {
      if (!flows) {
        console.error(`[reg-e] ACTION REQUIRED: dispute ${dispute.id} is past the 10-business-day mark and needs provisional credit (no platform balance configured to auto-issue).`);
        return;
      }
      await issueProvisionalCredit(prisma, dispute.id, { creditUser: flows.creditUser });
    },
    onFinalOverdue: async (dispute) => {
      console.error(`[reg-e] ESCALATE: dispute ${dispute.id} is past the 45-day final deadline.`);
    },
  });

  console.log("[jobs] recurring expenses + reconciliation + Reg E deadline sweeps scheduled");
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`even server on :${PORT}`);
  startBackgroundJobs();
});

export default app;
