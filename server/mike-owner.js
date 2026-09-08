// server/mike-owner.js
//
// Owner-only read access to real DoerToughMoney account data, for Mike AI.
//
// This deliberately does NOT live on the Mike gateway. The gateway
// (mike-gateway.js) is capability-only by design — it has no DATABASE_URL and
// no Plaid access, and that isolation is the reason it is safe to expose
// publicly. Real account data belongs on the main API, which already owns the
// database, so the gateway's guarantee stays true.
//
// Three properties make this safe to expose to another application:
//
//   1. The owner is pinned SERVER-SIDE. This route takes no user id, no email
//      and no filter of any kind from the caller. It resolves exactly one user
//      from MIKE_OWNER_EMAIL. Even with a leaked token, the worst an attacker
//      can read is the owner's own snapshot — never another user's row.
//   2. It is read-only. No POST, no mutation, nothing writable.
//   3. It uses its own credential, MIKE_OWNER_SERVICE_TOKEN, separate from the
//      gateway's MIKE_MONEY_SERVICE_TOKEN, so either can be rotated alone and a
//      compromise of the calculation gateway does not reach real data.
//
// Unset MIKE_OWNER_SERVICE_TOKEN or MIKE_OWNER_EMAIL and the route refuses
// every request, so it ships inert until both are deliberately set.
//
// FRESHNESS: a live Plaid pull is OPT-IN, never automatic. accountsBalanceGet
// is a billed, live call to the institution, so the default path reads stored
// rows and costs nothing. The caller asks for a live pull with ?refresh=live —
// Mike AI does that only when the question is actually about current balances
// or a specific account, not for general money talk.
//
// Two further guards apply even when live IS requested. A staleness window
// (MIKE_OWNER_REFRESH_MAX_AGE_SECONDS, default 120) means a burst of balance
// questions costs ONE bank round trip, not one per question. And a time budget
// (MIKE_OWNER_REFRESH_TIMEOUT_MS, default 7000) means a slow bank degrades to
// stored balances instead of hanging the caller: Mike AI's bridge aborts at
// 10s, and a voice answer cannot wait that long anyway. Every response says
// which path it took, so a stale number is always labelled as one.

import { computeSafeToSpendCents } from "./affordability.js";
import { syncAllForUser } from "./plaid/sync.js";
import {
  periodSummary,
  spendingByCategory,
  totalAvailableCents,
  totalDebtCents,
  topNegotiableBills,
  budgetStatus,
  goalProgress,
} from "./insights.js";

const SERVICE_TOKEN = String(process.env.MIKE_OWNER_SERVICE_TOKEN || "").trim();
const OWNER_EMAIL = String(process.env.MIKE_OWNER_EMAIL || "").trim().toLowerCase();

const DEFAULT_WINDOW_DAYS = 14;
const REFRESH_MAX_AGE_SECONDS = Math.max(Number(process.env.MIKE_OWNER_REFRESH_MAX_AGE_SECONDS) || 120, 0);
const REFRESH_TIMEOUT_MS = Math.min(Math.max(Number(process.env.MIKE_OWNER_REFRESH_TIMEOUT_MS) || 7000, 1000), 20000);
const SUMMARY_DAYS = 30;
const MAX_TRANSACTIONS = 500;

const dollars = (c) => (Number.isFinite(c) ? Math.round(c) / 100 : null);

function authorized(req) {
  const header = req.get("authorization");
  return Boolean(SERVICE_TOKEN) && header === `Bearer ${SERVICE_TOKEN}`;
}

export function mikeOwnerConfigured() {
  return Boolean(SERVICE_TOKEN && OWNER_EMAIL);
}

/**
 * Pull live from Plaid, bounded by a wall-clock budget. Never throws and never
 * blocks the answer: on timeout or Plaid failure the caller falls through to
 * stored balances and the response says so, because a late-but-labelled number
 * is more useful than an error, and a silently stale one is worse than both.
 */
async function refreshFromPlaid(prisma, userId, mode) {
  const started = Date.now();
  // Default is NO bank call. Only an explicit live/force asks Plaid for
  // anything, so routine money questions never touch the institution.
  if (mode !== "live" && mode !== "force") {
    return { attempted: false, completed: false, reason: "not_requested" };
  }

  if (mode !== "force" && REFRESH_MAX_AGE_SECONDS > 0) {
    const newest = await prisma.account.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    const ageSeconds = newest?.updatedAt ? (Date.now() - new Date(newest.updatedAt).getTime()) / 1000 : Infinity;
    if (ageSeconds < REFRESH_MAX_AGE_SECONDS) {
      return { attempted: false, completed: false, reason: "already_fresh", ageSeconds: Math.round(ageSeconds) };
    }
  }

  let timer;
  const budget = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), REFRESH_TIMEOUT_MS);
  });

  try {
    const outcome = await Promise.race([
      syncAllForUser(prisma, userId).then((items) => ({ items })),
      budget,
    ]);
    if (outcome.timedOut) {
      // The sync keeps running in the background; it just stops being this
      // request's problem, so the next question benefits from it.
      return { attempted: true, completed: false, timedOut: true, durationMs: Date.now() - started };
    }
    const items = outcome.items || [];
    return {
      attempted: true,
      completed: true,
      durationMs: Date.now() - started,
      itemsSynced: items.filter((i) => !i.error).length,
      itemsFailed: items.filter((i) => i.error).length,
    };
  } catch (error) {
    console.error("[mike-owner] plaid refresh failed:", error?.message || error);
    return { attempted: true, completed: false, error: true, durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export function installMikeOwnerRoutes(app, prisma) {
  app.get("/api/v1/mike/owner/snapshot", async (req, res) => {
    if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
    if (!OWNER_EMAIL) return res.status(503).json({ error: "owner_not_configured" });

    try {
      // The only identity this route will ever accept. Nothing from the request
      // participates in choosing whose data is returned.
      const owner = await prisma.user.findUnique({
        where: { email: OWNER_EMAIL },
        select: { id: true, name: true, email: true },
      });
      if (!owner) return res.status(404).json({ error: "owner_account_not_found" });

      const windowDays = Math.min(Math.max(Number(req.query.windowDays) || DEFAULT_WINDOW_DAYS, 1), 90);
      const since = new Date(Date.now() - SUMMARY_DAYS * 86400000);

      // Opt-in live pull. When it runs, everything below reads freshly synced
      // rows; when it does not, these are the last synced values and the
      // response says so via balancesLive.
      const refresh = await refreshFromPlaid(prisma, owner.id, String(req.query.refresh || "stored"));

      const [accounts, bills, transactions, budgets, goals, plaidItems] = await Promise.all([
        prisma.account.findMany({ where: { userId: owner.id }, orderBy: { createdAt: "asc" } }),
        prisma.bill.findMany({ where: { userId: owner.id, active: true }, orderBy: { amountCents: "desc" } }),
        prisma.transaction.findMany({
          where: { userId: owner.id, date: { gte: since } },
          orderBy: { date: "desc" },
          take: MAX_TRANSACTIONS,
        }),
        prisma.budget.findMany({ where: { userId: owner.id } }),
        prisma.goal.findMany({ where: { userId: owner.id } }),
        prisma.plaidItem.findMany({ where: { userId: owner.id }, select: { institutionName: true, status: true, updatedAt: true } }),
      ]);

      const safeToSpendCents = computeSafeToSpendCents(accounts, bills, { windowDays });
      const summary = periodSummary(transactions);

      const spentByCategory = new Map(spendingByCategory(transactions).map((c) => [c.category, c.cents]));

      res.json({
        owner: { name: owner.name, email: owner.email },
        asOf: new Date().toISOString(),
        windowDays,
        summaryDays: SUMMARY_DAYS,
        safeToSpend: dollars(safeToSpendCents),
        safeToSpendKnown: safeToSpendCents != null,
        available: dollars(totalAvailableCents(accounts)),
        debt: dollars(totalDebtCents(accounts)),
        accounts: accounts.map((a) => ({
          name: a.name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          available: dollars(a.availableBalanceCents),
          current: dollars(a.currentBalanceCents),
        })),
        bills: bills.map((b) => ({
          name: b.name,
          amount: dollars(b.amountCents),
          cadence: b.cadence,
          nextDueOn: b.nextDueOn ? b.nextDueOn.toISOString().slice(0, 10) : null,
          category: b.category,
        })),
        negotiableBills: topNegotiableBills(bills).slice(0, 5).map((b) => ({ name: b.name, amount: dollars(b.amountCents) })),
        spend: dollars(summary.spendCents),
        income: dollars(summary.incomeCents),
        net: dollars(summary.netCents),
        topCategories: spendingByCategory(transactions).slice(0, 10).map((c) => ({ category: c.category, amount: dollars(c.cents) })),
        budgets: budgets.map((b) =>
          budgetStatus(
            { category: b.category, monthlyLimitCents: b.monthlyLimitCents },
            spentByCategory.get(b.category) || 0
          )
        ),
        goals: goals.map((g) => ({
          name: g.name,
          target: dollars(g.targetCents),
          current: dollars(g.currentCents),
          progress: goalProgress({ targetCents: g.targetCents, currentCents: g.currentCents }),
          targetDate: g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null,
        })),
        // Surfaced so Mike can say "your bank link needs reconnecting" instead
        // of quietly reporting stale balances as current.
        links: plaidItems.map((item) => ({
          institution: item.institutionName,
          status: item.status,
          lastUpdated: item.updatedAt ? item.updatedAt.toISOString() : null,
        })),
        stale: plaidItems.some((item) => item.status !== "ACTIVE"),
        refresh,
        balancesLive: Boolean(refresh.completed || refresh.reason === "already_fresh"),
        // Present so Mike can caveat honestly: these are last-synced numbers,
        // not a live read of the bank.
        balancesFromStoredSync: !(refresh.completed || refresh.reason === "already_fresh"),
        transactionsCounted: transactions.length,
        transactionsTruncated: transactions.length === MAX_TRANSACTIONS,
      });
    } catch (error) {
      console.error("[mike-owner] snapshot failed:", error?.message || error);
      res.status(500).json({ error: "owner_snapshot_failed" });
    }
  });
}
