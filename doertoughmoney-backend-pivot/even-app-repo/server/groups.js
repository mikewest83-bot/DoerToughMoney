// Pure math for shared group expenses. No Prisma, no Express — so the logic
// that decides who owes whom is unit-testable without a database.
//
// Everything is integer cents. Two invariants hold throughout and are asserted
// in groups.test.js:
//   1. an expense's shares sum EXACTLY to its total (no cent evaporates)
//   2. net balances across a group sum to zero

/**
 * Split an amount evenly, distributing the leftover cents deterministically.
 * $10 across 3 people is 334/333/333 — never 333/333/333, which would lose a
 * cent, and never a float. Earlier members absorb the remainder, so repeat
 * runs on the same member order always agree.
 * @returns {Array<{memberId, shareCents}>}
 */
export function splitEqual(amountCents, memberIds) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("amountCents must be a positive integer");
  if (!memberIds?.length) throw new Error("need at least one member to split between");

  const base = Math.floor(amountCents / memberIds.length);
  let remainder = amountCents - base * memberIds.length;
  return memberIds.map((memberId) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { memberId, shareCents: base + extra };
  });
}

/**
 * Validate a caller-supplied EXACT split. Shares must cover every cent —
 * otherwise the group's balances silently stop adding up.
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateShares(amountCents, shares) {
  if (!Array.isArray(shares) || shares.length === 0) return { ok: false, error: "Split at least one share." };
  for (const s of shares) {
    if (!Number.isInteger(s.shareCents) || s.shareCents < 0)
      return { ok: false, error: "Each share must be zero or more." };
  }
  const total = shares.reduce((sum, s) => sum + s.shareCents, 0);
  if (total !== amountCents) {
    const diff = (Math.abs(total - amountCents) / 100).toFixed(2);
    return { ok: false, error: total > amountCents ? `Shares are $${diff} over the total.` : `Shares are $${diff} short of the total.` };
  }
  return { ok: true };
}

/**
 * Net position per member. Positive means the group owes them; negative means
 * they owe the group.
 *
 *   net = what they paid out
 *       − what they were responsible for
 *       − settlements they received
 *       + settlements they made
 *
 * Receiving a settlement reduces what you're owed; making one reduces what you
 * owe (so it moves your net up). Always sums to zero across the group.
 *
 * @param expenses     [{ paidByMemberId, amountCents, shares: [{memberId, shareCents}] }]
 * @param settlements  [{ fromMemberId, toMemberId, amountCents }]
 * @param memberIds    all members, so people with no activity still appear at 0
 * @returns {Object<string, number>} memberId -> net cents
 */
export function computeNetBalances({ expenses = [], settlements = [], memberIds = [] } = {}) {
  const net = {};
  for (const id of memberIds) net[id] = 0;
  const bump = (id, cents) => { net[id] = (net[id] ?? 0) + cents; };

  for (const e of expenses) {
    bump(e.paidByMemberId, e.amountCents);
    for (const s of e.shares ?? []) bump(s.memberId, -s.shareCents);
  }
  for (const s of settlements) {
    bump(s.fromMemberId, s.amountCents);
    bump(s.toMemberId, -s.amountCents);
  }
  return net;
}

/**
 * Reduce net balances to the fewest transfers that clear them. Greedy
 * min-cash-flow: repeatedly settle the largest debtor against the largest
 * creditor. Produces at most n−1 transfers rather than a pairwise mesh, which
 * matters because every real settlement costs an ACH transfer.
 *
 * Consequence worth surfacing in the UI: you may be told to pay someone you
 * never transacted with directly. Show the underlying expenses alongside.
 *
 * @returns {Array<{fromMemberId, toMemberId, amountCents}>}
 */
export function simplifyDebts(net) {
  const debtors = [];
  const creditors = [];
  for (const [memberId, cents] of Object.entries(net)) {
    if (cents < 0) debtors.push({ memberId, cents: -cents });
    else if (cents > 0) creditors.push({ memberId, cents });
  }
  // Largest first, so each step clears at least one party completely.
  debtors.sort((a, b) => b.cents - a.cents);
  creditors.sort((a, b) => b.cents - a.cents);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].cents, creditors[j].cents);
    if (amount > 0) {
      transfers.push({ fromMemberId: debtors[i].memberId, toMemberId: creditors[j].memberId, amountCents: amount });
      debtors[i].cents -= amount;
      creditors[j].cents -= amount;
    }
    if (debtors[i].cents === 0) i++;
    if (creditors[j].cents === 0) j++;
  }
  return transfers;
}

/** What a specific member owes / is owed, from the simplified transfer list. */
export function memberSummary(memberId, net, transfers) {
  const owes = transfers.filter((t) => t.fromMemberId === memberId);
  const owed = transfers.filter((t) => t.toMemberId === memberId);
  return {
    netCents: net[memberId] ?? 0,
    owes,   // this member should pay these people
    owed,   // these people should pay this member
  };
}

// ── recurrence ───────────────────────────────────────────
// dayOfMonth is capped at 28 so "the 1st" and "the 28th" behave identically in
// February — no silently skipped months.
export const MAX_DAY_OF_MONTH = 28;

/**
 * The next date a schedule should fire, strictly after `from`.
 * @param interval "WEEKLY" | "MONTHLY"
 */
export function nextOccurrence(from, { interval, dayOfMonth, dayOfWeek }) {
  const d = new Date(from);
  if (interval === "WEEKLY") {
    const target = Number(dayOfWeek ?? 1);
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== target);
    return d;
  }
  if (interval === "MONTHLY") {
    const target = Math.min(Number(dayOfMonth ?? 1), MAX_DAY_OF_MONTH);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), target));
    if (next <= d) next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(target); // re-assert after the month rollover
    return next;
  }
  throw new Error(`unknown interval: ${interval}`);
}

/**
 * Stable identifier for "this schedule, this period" so re-running the
 * materializer can't create rent twice.
 */
export function periodKey(recurringExpenseId, date) {
  return `${recurringExpenseId}:${new Date(date).toISOString().slice(0, 10)}`;
}

// ── reminders ────────────────────────────────────────────
// A reminder pokes someone who owes you. The cooldown is the whole safety
// mechanism: without it this is a nagging tool, and being able to spam someone
// through a payments app is worse than not having the feature.
export const REMIND_COOLDOWN_HOURS = 24;

/**
 * May this person send another reminder yet?
 * @param lastSentAt  when they last reminded this same person in this group, or null
 * @returns {{ok: true} | {ok: false, hoursLeft: number}}
 */
export function canRemind(lastSentAt, now = new Date(), cooldownHours = REMIND_COOLDOWN_HOURS) {
  if (!lastSentAt) return { ok: true };
  const elapsedMs = new Date(now).getTime() - new Date(lastSentAt).getTime();
  const cooldownMs = cooldownHours * 3600_000;
  if (elapsedMs >= cooldownMs) return { ok: true };
  // Round up so "1 hour left" never displays while 10 minutes remain.
  return { ok: false, hoursLeft: Math.ceil((cooldownMs - elapsedMs) / 3600_000) };
}

/**
 * Reminders are only legitimate from a creditor to a debtor. Checking against
 * the simplified transfer list means you can't remind someone the ledger says
 * owes you nothing.
 */
export function isOwedBy(transfers, creditorMemberId, debtorMemberId) {
  return transfers.some((t) => t.toMemberId === creditorMemberId && t.fromMemberId === debtorMemberId);
}
