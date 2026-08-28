import { computeSafeToSpendCents, assessPurchase } from "./affordability.js";
import { spendingByCategory, periodSummary, monthOverMonth, topNegotiableBills, totalAvailableCents, totalDebtCents, budgetStatus, goalProgress } from "./insights.js";

function cents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function normalizeAccounts(accounts = []) {
  return Array.isArray(accounts) ? accounts.map((a) => ({
    type: String(a?.type || ""),
    availableBalanceCents: Number.isFinite(Number(a?.availableBalanceCents)) ? Number(a.availableBalanceCents) : cents(a?.availableBalance),
    currentBalanceCents: Number.isFinite(Number(a?.currentBalanceCents)) ? Number(a.currentBalanceCents) : cents(a?.currentBalance),
  })) : [];
}

function normalizeBills(bills = []) {
  return Array.isArray(bills) ? bills.map((b) => ({
    active: b?.active !== false,
    amountCents: Number.isFinite(Number(b?.amountCents)) ? Number(b.amountCents) : cents(b?.amount),
    cadence: String(b?.cadence || "UNKNOWN").toUpperCase(),
    nextDueOn: b?.nextDueOn || null,
    name: b?.name || null,
    category: b?.category || null,
  })) : [];
}

function normalizeTransactions(transactions = []) {
  return Array.isArray(transactions) ? transactions.map((t) => ({
    amountCents: Number.isFinite(Number(t?.amountCents)) ? Number(t.amountCents) : cents(t?.amount),
    category: t?.category || "Uncategorized",
  })) : [];
}

/**
 * Capability-only Money intelligence for Mike. It contains no Plaid access,
 * database access, authentication, or UI concerns. Mike may supply user
 * provided financial facts to run the same proven Money calculations.
 */
export function analyzeMoneyScenario({ capability, input = {} } = {}) {
  const name = String(capability || "").trim().toLowerCase();
  const accounts = normalizeAccounts(input.accounts);
  const bills = normalizeBills(input.bills);
  const transactions = normalizeTransactions(input.transactions);

  switch (name) {
    case "safe_to_spend": {
      const safe = computeSafeToSpendCents(accounts, bills, { windowDays: Number(input.windowDays) || 14 });
      return { capability: name, safeToSpend: safe == null ? null : safe / 100, known: safe != null };
    }
    case "purchase_affordability": {
      const deal = input.deal || null;
      const askingPrice = Number(input.askingPrice);
      const safe = computeSafeToSpendCents(accounts, bills, { windowDays: Number(input.windowDays) || 14 });
      return { capability: name, affordability: assessPurchase(deal, askingPrice, safe) };
    }
    case "spending_summary": {
      const summary = periodSummary(transactions);
      return { capability: name, spend: summary.spendCents / 100, income: summary.incomeCents / 100, net: summary.netCents / 100, byCategory: spendingByCategory(transactions).slice(0, 10).map((x) => ({ category: x.category, amount: x.cents / 100 })) };
    }
    case "spending_trend": {
      const current = normalizeTransactions(input.currentTransactions);
      const previous = normalizeTransactions(input.previousTransactions);
      return { capability: name, monthOverMonth: monthOverMonth(current, previous).slice(0, 10).map((x) => ({ category: x.category, current: x.currentCents / 100, previous: x.previousCents / 100, change: x.deltaCents / 100 })) };
    }
    case "financial_snapshot": {
      const budgets = Array.isArray(input.budgets) ? input.budgets : [];
      const goals = Array.isArray(input.goals) ? input.goals : [];
      const summary = periodSummary(transactions);
      return {
        capability: name,
        available: totalAvailableCents(accounts) / 100,
        debt: totalDebtCents(accounts) / 100,
        spend: summary.spendCents / 100,
        income: summary.incomeCents / 100,
        topNegotiableBills: topNegotiableBills(bills).slice(0, 5).map((b) => ({ name: b.name, amount: b.amountCents / 100 })),
        budgets: budgets.slice(0, 20).map((b) => budgetStatus({ category: b.category, monthlyLimitCents: cents(b.monthlyLimit ?? b.monthlyLimitCents / 100) }, cents(b.spent ?? b.spentCents / 100))),
        goals: goals.slice(0, 20).map((g) => ({ name: g.name, progress: goalProgress({ targetCents: cents(g.target ?? g.targetCents / 100), currentCents: cents(g.current ?? g.currentCents / 100) }) })),
      };
    }
    default:
      throw new Error("money_capability_not_supported");
  }
}

export const MIKE_MONEY_CAPABILITIES = [
  "safe_to_spend",
  "purchase_affordability",
  "spending_summary",
  "spending_trend",
  "financial_snapshot",
];
