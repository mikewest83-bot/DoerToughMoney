// Pure logic for the "what's my financial trajectory" surface — spending by
// category, month-over-month trend, and which recurring bills are the
// biggest targets for DealTough to look at. No Prisma, no Express, so it's
// unit-testable the same way logic.js and groups.js are.

/**
 * Plaid labels account-to-account movements as TRANSFER_IN / TRANSFER_OUT.
 * They change cash between accounts but are not income or consumer spending.
 * Keep this centralized so every insight calculation treats transfers the
 * same way.
 */
export function isTransferTransaction(transaction) {
  const category = String(transaction?.category || "").trim().toUpperCase();
  return category === "TRANSFER" || category.startsWith("TRANSFER_");
}

/** Sum of transfer movement in/out, kept separate from true income/spending. */
export function transferSummary(transactions) {
  let transferOutCents = 0;
  let transferInCents = 0;
  for (const t of transactions) {
    if (!isTransferTransaction(t)) continue;
    if (t.amountCents > 0) transferOutCents += t.amountCents;
    else transferInCents += -t.amountCents;
  }
  return { transferOutCents, transferInCents };
}

/** Sum of amountCents for money OUT (positive, per Plaid's convention) in a period. */
export function spendingByCategory(transactions) {
  const byCategory = {};
  for (const t of transactions) {
    if (t.amountCents <= 0 || isTransferTransaction(t)) continue; // deposits/refunds and internal transfers are not spend
    const key = t.category || "Uncategorized";
    byCategory[key] = (byCategory[key] || 0) + t.amountCents;
  }
  return Object.entries(byCategory)
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents);
}

/** Total true spend and true income (each as a positive cents figure) for a period. */
export function periodSummary(transactions) {
  let spendCents = 0;
  let incomeCents = 0;
  for (const t of transactions) {
    if (isTransferTransaction(t)) continue;
    if (t.amountCents > 0) spendCents += t.amountCents;
    else incomeCents += -t.amountCents;
  }
  return { spendCents, incomeCents, netCents: incomeCents - spendCents };
}

/**
 * Compare this period's spend against the previous one, by category.
 * @returns {Array<{category, currentCents, previousCents, deltaCents}>} sorted by |delta| desc
 */
export function monthOverMonth(currentTxns, previousTxns) {
  const current = Object.fromEntries(spendingByCategory(currentTxns).map((c) => [c.category, c.cents]));
  const previous = Object.fromEntries(spendingByCategory(previousTxns).map((c) => [c.category, c.cents]));
  const categories = new Set([...Object.keys(current), ...Object.keys(previous)]);
  return [...categories]
    .map((category) => {
      const currentCents = current[category] || 0;
      const previousCents = previous[category] || 0;
      return { category, currentCents, previousCents, deltaCents: currentCents - previousCents };
    })
    .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
}

/**
 * Which active bills are the best DealTough candidates: recurring, and above
 * a "worth negotiating" floor. Sorted biggest-first, since that's where a
 * percentage discount saves the most in absolute dollars.
 */
export function topNegotiableBills(bills, minCents = 2000) {
  return bills
    .filter((b) => b.active && b.amountCents >= minCents)
    .sort((a, b) => b.amountCents - a.amountCents);
}

/**
 * A user's total available balance across depository accounts (checking +
 * savings) — "what money do I have," excluding credit/loan accounts where a
 * positive balance means debt, not cash on hand.
 */
export function totalAvailableCents(accounts) {
  return accounts
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + (a.availableBalanceCents ?? a.currentBalanceCents ?? 0), 0);
}

/** Total owed across credit + loan accounts — "what I owe." */
export function totalDebtCents(accounts) {
  return accounts
    .filter((a) => a.type === "credit" || a.type === "loan")
    .reduce((sum, a) => sum + Math.max(a.currentBalanceCents ?? 0, 0), 0);
}

/**
 * Budget status for a category: how much of the monthly limit has been spent,
 * and whether it's over.
 */
export function budgetStatus(budget, spentCentsThisMonth) {
  const spent = spentCentsThisMonth || 0;
  const remaining = budget.monthlyLimitCents - spent;
  return {
    category: budget.category,
    limitCents: budget.monthlyLimitCents,
    spentCents: spent,
    remainingCents: remaining,
    overBudget: remaining < 0,
    percentUsed: budget.monthlyLimitCents > 0 ? Math.round((spent / budget.monthlyLimitCents) * 100) : 0,
  };
}

/** Progress toward a savings goal, as a percentage (capped at 100). */
export function goalProgress(goal) {
  if (goal.targetCents <= 0) return 0;
  return Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100));
}
