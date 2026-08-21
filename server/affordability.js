// server/affordability.js
//
// The DealTough <-> real-money join. DealTough scores whether a purchase is
// a good DEAL (price vs. market comparables) — it knows nothing about the
// user's own finances. This module answers the separate question: can this
// user actually AFFORD it right now, given what's sitting in their linked
// accounts and what's about to come out for bills. A good deal you can't
// afford and a bad deal you can afford are different problems, so the two
// verdicts are always reported separately, never blended into one.
//
// No Prisma, no Express here — same pattern as insights.js/logic.js, so this
// stays unit-testable without a database.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Bill.nextDueOn is a calendar date stored at UTC midnight. It must be read
// by its UTC date parts, never shifted by local timezone offset — shifting
// turns "due today" into yesterday or tomorrow depending on which side of
// UTC the server/user sits on.
function utcMidnight(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function addMonthsUtc(ms, months) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const firstOfTarget = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
  const daysInTarget = new Date(Date.UTC(new Date(firstOfTarget).getUTCFullYear(), new Date(firstOfTarget).getUTCMonth() + 1, 0)).getUTCDate();
  // Clamp so e.g. Jan 31 + 1 month lands on Feb 28/29, not overflows into March.
  return Date.UTC(new Date(firstOfTarget).getUTCFullYear(), new Date(firstOfTarget).getUTCMonth(), Math.min(day, daysInTarget));
}

function addYearsUtc(ms, years) {
  return addMonthsUtc(ms, years * 12);
}

/**
 * Roll a possibly-stale due date forward to its next real occurrence at or
 * after `todayMs`, one cadence step at a time. A bill that's been overdue
 * for months doesn't retroactively owe every missed occurrence — it's just
 * next due whenever the schedule actually lands next.
 */
function nextOccurrenceMs(dueMs, cadence, todayMs) {
  let occurrence = dueMs;
  let guard = 0; // sanity cap — a real schedule converges in a handful of steps
  while (occurrence < todayMs && guard < 1000) {
    if (cadence === "WEEKLY") occurrence += 7 * MS_PER_DAY;
    else if (cadence === "MONTHLY") occurrence = addMonthsUtc(occurrence, 1);
    else if (cadence === "YEARLY") occurrence = addYearsUtc(occurrence, 1);
    else return occurrence; // UNKNOWN cadence doesn't repeat — it just stays put
    guard++;
  }
  return occurrence;
}

/**
 * Every occurrence of one bill landing inside [todayMs, windowEndMs]. A
 * WEEKLY bill can land more than once in a 14-day window; MONTHLY/YEARLY
 * bills land at most once at that scale.
 */
function occurrencesInWindow(bill, todayMs, windowEndMs) {
  if (!bill.nextDueOn) return [];
  const dueMs = utcMidnight(new Date(bill.nextDueOn));
  const first = nextOccurrenceMs(dueMs, bill.cadence, todayMs);
  if (first > windowEndMs) return [];

  const occurrences = [first];
  if (bill.cadence === "WEEKLY") {
    let next = first + 7 * MS_PER_DAY;
    while (next <= windowEndMs) {
      occurrences.push(next);
      next += 7 * MS_PER_DAY;
    }
  }
  return occurrences;
}

/**
 * Sum of every active bill's occurrences due in the next `windowDays`,
 * expanding WEEKLY bills that land more than once and rolling stale due
 * dates forward instead of accruing missed occurrences.
 */
export function upcomingBillCents(bills, { now = new Date(), windowDays = 14 } = {}) {
  const todayMs = utcMidnight(now);
  const windowEndMs = todayMs + windowDays * MS_PER_DAY;
  return bills
    .filter((b) => b.active)
    .reduce((sum, b) => sum + occurrencesInWindow(b, todayMs, windowEndMs).length * b.amountCents, 0);
}

/**
 * "What money do I actually have to spend" — total available balance across
 * depository accounts (checking/savings; a positive credit/loan balance is
 * debt, not cash on hand) minus every bill occurrence due in the next
 * `windowDays`.
 *
 * Returns `null` — not $0 — when there's no linked depository account at
 * all, so a caller can tell "we don't know" apart from "genuinely broke."
 */
export function computeSafeToSpendCents(accounts, bills, opts = {}) {
  const depository = accounts.filter((a) => a.type === "depository");
  if (depository.length === 0) return null;

  const availableCents = depository.reduce(
    (sum, a) => sum + (a.availableBalanceCents ?? a.currentBalanceCents ?? 0),
    0
  );
  return availableCents - upcomingBillCents(bills, opts);
}

export const AFFORDABILITY_VERDICTS = {
  AFFORDABLE: "affordable",
  TIGHT: "tight",
  NEGOTIATE_TO_AFFORD: "negotiate_to_afford",
  OUT_OF_REACH: "out_of_reach",
};

const TIGHT_BUFFER_FLOOR_CENTS = 20000; // $200 — the minimum "close enough to flag" gap
const TIGHT_BUFFER_RATE = 0.1; // or 10% of safe-to-spend, whichever is bigger

/**
 * Join a DealTough deal verdict to real affordability.
 *
 * @param {object} deal  DealTough's DealRecommendation. `targetPrice`/
 *   `walkAwayPrice` are only trusted when `deal.valuationBasis` isn't
 *   "unknown" — same rule dealtough.js already applies to fairMarketValue,
 *   since DealTough itself is saying it couldn't price the item.
 * @param {number} askingPriceDollars  from the original request — DealTough
 *   doesn't echo askingPrice back on its recommendation.
 * @param {number|null} safeToSpendCents  from computeSafeToSpendCents();
 *   `null` means "no linked account," so the result is `null` too — an
 *   affordability verdict shouldn't be invented from nothing.
 * @returns {{verdict:string, safeToSpendCents:number, shortfallCents:number, negotiateToCents?:number}|null}
 */
export function assessPurchase(deal, askingPriceDollars, safeToSpendCents) {
  if (safeToSpendCents == null) return null;

  const askingCents = Math.round((Number(askingPriceDollars) || 0) * 100);

  if (askingCents <= safeToSpendCents) {
    return { verdict: AFFORDABILITY_VERDICTS.AFFORDABLE, safeToSpendCents, shortfallCents: 0 };
  }

  const shortfallCents = askingCents - safeToSpendCents;

  const hasValuation = !!deal && deal.valuationBasis && deal.valuationBasis !== "unknown";
  const walkAwayCents = hasValuation && Number.isFinite(deal.walkAwayPrice)
    ? Math.round(deal.walkAwayPrice * 100)
    : null;

  if (walkAwayCents != null && walkAwayCents <= safeToSpendCents) {
    return {
      verdict: AFFORDABILITY_VERDICTS.NEGOTIATE_TO_AFFORD,
      safeToSpendCents,
      shortfallCents,
      negotiateToCents: walkAwayCents,
    };
  }

  const tightBufferCents = Math.max(TIGHT_BUFFER_FLOOR_CENTS, Math.round(safeToSpendCents * TIGHT_BUFFER_RATE));
  if (shortfallCents <= tightBufferCents) {
    return { verdict: AFFORDABILITY_VERDICTS.TIGHT, safeToSpendCents, shortfallCents };
  }

  return { verdict: AFFORDABILITY_VERDICTS.OUT_OF_REACH, safeToSpendCents, shortfallCents };
}
