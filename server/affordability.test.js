import { describe, it, expect } from "vitest";
import { computeSafeToSpendCents, upcomingBillCents, assessPurchase, AFFORDABILITY_VERDICTS } from "./affordability.js";

const NOW = new Date("2026-08-21T12:00:00.000Z"); // a Friday, mid-day UTC on purpose (tz-shift bugs hide at midnight)

const depository = (availableCents) => ({ type: "depository", availableBalanceCents: availableCents, currentBalanceCents: availableCents });
const credit = (balanceCents) => ({ type: "credit", currentBalanceCents: balanceCents });

const bill = (over) => ({
  id: "b1", active: true, amountCents: 10000, cadence: "MONTHLY", nextDueOn: NOW, ...over,
});

describe("upcomingBillCents", () => {
  it("counts a bill due today", () => {
    expect(upcomingBillCents([bill({ nextDueOn: NOW })], { now: NOW })).toBe(10000);
  });

  it("counts a bill due later in the window, excludes one past it", () => {
    const inWindow = bill({ id: "in", amountCents: 5000, cadence: "UNKNOWN", nextDueOn: new Date("2026-08-30T00:00:00.000Z") }); // +9d
    const pastWindow = bill({ id: "out", amountCents: 9999, cadence: "UNKNOWN", nextDueOn: new Date("2026-09-10T00:00:00.000Z") }); // +20d
    expect(upcomingBillCents([inWindow, pastWindow], { now: NOW, windowDays: 14 })).toBe(5000);
  });

  it("expands a WEEKLY bill that lands more than once in a 14-day window", () => {
    // Window is inclusive of day 14, so a bill due today also lands again at
    // day 7 and day 14 — three occurrences, not one.
    const weekly = bill({ cadence: "WEEKLY", amountCents: 2000, nextDueOn: NOW });
    expect(upcomingBillCents([weekly], { now: NOW, windowDays: 14 })).toBe(6000);
  });

  it("ignores inactive bills", () => {
    expect(upcomingBillCents([bill({ active: false })], { now: NOW })).toBe(0);
  });

  it("rolls a stale MONTHLY bill forward instead of accruing missed months", () => {
    // 70 days overdue: 70 -> 40 -> 10 -> (-20, i.e. 20 days in the future) after
    // three monthly rolls — lands outside a 14-day window, contributes $0.
    // (If this instead accrued every missed month it would wrongly count.)
    const stale = bill({ nextDueOn: new Date(NOW.getTime() - 70 * 24 * 60 * 60 * 1000) });
    expect(upcomingBillCents([stale], { now: NOW, windowDays: 14 })).toBe(0);
  });

  it("rolls a stale WEEKLY bill to its very next occurrence, not every missed week", () => {
    // 10 days overdue -> next weekly occurrence is 4 days out (10 - 7 = 3 days
    // overdue -> +7 = 4 days future), inside the window, counted once (unless
    // a second occurrence also lands, which it does at day 11).
    const stale = bill({ cadence: "WEEKLY", amountCents: 1500, nextDueOn: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000) });
    expect(upcomingBillCents([stale], { now: NOW, windowDays: 14 })).toBe(3000); // two occurrences: day 4 and day 11
  });

  it("a bill with no nextDueOn contributes nothing", () => {
    expect(upcomingBillCents([bill({ nextDueOn: null })], { now: NOW })).toBe(0);
  });
});

describe("computeSafeToSpendCents", () => {
  it("returns null with no depository account, even if credit accounts exist", () => {
    expect(computeSafeToSpendCents([credit(-50000)], [], { now: NOW })).toBeNull();
  });

  it("sums only depository balances, ignoring credit/loan", () => {
    const accounts = [depository(100000), credit(-30000)];
    expect(computeSafeToSpendCents(accounts, [], { now: NOW })).toBe(100000);
  });

  it("subtracts bills due in the window", () => {
    const accounts = [depository(100000)];
    const bills = [bill({ amountCents: 40000, cadence: "UNKNOWN", nextDueOn: NOW })];
    expect(computeSafeToSpendCents(accounts, bills, { now: NOW })).toBe(60000);
  });

  it("can go negative when bills exceed the balance — a real shortfall, not clamped to zero", () => {
    const accounts = [depository(10000)];
    const bills = [bill({ amountCents: 40000, cadence: "UNKNOWN", nextDueOn: NOW })];
    expect(computeSafeToSpendCents(accounts, bills, { now: NOW })).toBe(-30000);
  });
});

describe("assessPurchase", () => {
  const cheapDeal = { valuationBasis: "market", walkAwayPrice: 400 };
  const unknownDeal = { valuationBasis: "unknown", walkAwayPrice: 400 };

  it("returns null when safeToSpendCents is null (no linked account)", () => {
    expect(assessPurchase(cheapDeal, 500, null)).toBeNull();
  });

  it("is affordable when asking price is within safe-to-spend", () => {
    const r = assessPurchase(cheapDeal, 500, 100000); // $500 asking, $1000 safe
    expect(r.verdict).toBe(AFFORDABILITY_VERDICTS.AFFORDABLE);
    expect(r.shortfallCents).toBe(0);
  });

  it("suggests negotiate_to_afford when the walk-away price would fit", () => {
    const r = assessPurchase(cheapDeal, 1000, 50000); // $1000 asking, $500 safe, walkAway $400
    expect(r.verdict).toBe(AFFORDABILITY_VERDICTS.NEGOTIATE_TO_AFFORD);
    expect(r.negotiateToCents).toBe(40000);
  });

  it("never trusts walkAwayPrice when valuationBasis is unknown", () => {
    // Same numbers as the negotiate_to_afford case above, but DealTough
    // couldn't price it — walkAwayPrice must be ignored entirely.
    const r = assessPurchase(unknownDeal, 1000, 50000);
    expect(r.verdict).not.toBe(AFFORDABILITY_VERDICTS.NEGOTIATE_TO_AFFORD);
  });

  it("is tight when the shortfall is small", () => {
    const r = assessPurchase({ valuationBasis: "unknown" }, 600, 55000); // $600 asking, $550 safe -> $50 short
    expect(r.verdict).toBe(AFFORDABILITY_VERDICTS.TIGHT);
  });

  it("is out_of_reach when the shortfall is large and negotiating wouldn't help", () => {
    const r = assessPurchase({ valuationBasis: "unknown" }, 5000, 10000); // $5000 asking, $100 safe
    expect(r.verdict).toBe(AFFORDABILITY_VERDICTS.OUT_OF_REACH);
  });

  it("still returns a verdict when already short before payday (negative safe-to-spend)", () => {
    const r = assessPurchase({ valuationBasis: "unknown" }, 500, -10000); // $500 asking while already $100 short
    expect(r.verdict).toBe(AFFORDABILITY_VERDICTS.OUT_OF_REACH);
    expect(r.safeToSpendCents).toBe(-10000);
  });
});
