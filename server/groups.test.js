import { describe, it, expect } from "vitest";
import {
  splitEqual, validateShares, computeNetBalances, simplifyDebts,
  memberSummary, nextOccurrence, periodKey, MAX_DAY_OF_MONTH,
  canRemind, isOwedBy, REMIND_COOLDOWN_HOURS,
} from "./groups.js";

const sum = (xs, f) => xs.reduce((t, x) => t + f(x), 0);

describe("splitEqual", () => {
  it("splits evenly when it divides cleanly", () => {
    expect(splitEqual(3000, ["a", "b", "c"]).map((s) => s.shareCents)).toEqual([1000, 1000, 1000]);
  });

  it("never loses a cent to rounding", () => {
    // $10 / 3 = 3.333… — the extra cent has to land somewhere.
    const shares = splitEqual(1000, ["a", "b", "c"]);
    expect(shares.map((s) => s.shareCents)).toEqual([334, 333, 333]);
    expect(sum(shares, (s) => s.shareCents)).toBe(1000);
  });

  it("sums exactly for every awkward amount and party size", () => {
    for (let amount = 1; amount <= 200; amount++) {
      for (let n = 1; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => `m${i}`);
        expect(sum(splitEqual(amount, ids), (s) => s.shareCents)).toBe(amount);
      }
    }
  });

  it("is deterministic for the same member order", () => {
    expect(splitEqual(1000, ["a", "b", "c"])).toEqual(splitEqual(1000, ["a", "b", "c"]));
  });

  it("rejects nonsense input", () => {
    expect(() => splitEqual(0, ["a"])).toThrow();
    expect(() => splitEqual(-100, ["a"])).toThrow();
    expect(() => splitEqual(100, [])).toThrow();
  });
});

describe("validateShares", () => {
  it("accepts shares that cover the total exactly", () => {
    expect(validateShares(2500, [{ shareCents: 1000 }, { shareCents: 1500 }]).ok).toBe(true);
  });
  it("rejects shares that don't add up, and says by how much", () => {
    expect(validateShares(2500, [{ shareCents: 1000 }, { shareCents: 1000 }])).toMatchObject({ ok: false });
    expect(validateShares(2500, [{ shareCents: 1000 }, { shareCents: 1000 }]).error).toContain("5.00");
    expect(validateShares(2500, [{ shareCents: 2000 }, { shareCents: 1000 }]).error).toContain("over");
  });
  it("allows a zero share (someone who didn't partake)", () => {
    expect(validateShares(1000, [{ shareCents: 1000 }, { shareCents: 0 }]).ok).toBe(true);
  });
  it("rejects negative shares and empty splits", () => {
    expect(validateShares(1000, [{ shareCents: 1200 }, { shareCents: -200 }]).ok).toBe(false);
    expect(validateShares(1000, []).ok).toBe(false);
  });
});

describe("computeNetBalances", () => {
  const memberIds = ["a", "b", "c"];

  it("credits the payer and debits each person's share", () => {
    // a pays $30 for dinner, split three ways.
    const net = computeNetBalances({
      memberIds,
      expenses: [{ paidByMemberId: "a", amountCents: 3000, shares: splitEqual(3000, memberIds) }],
    });
    expect(net).toEqual({ a: 2000, b: -1000, c: -1000 });
  });

  it("always sums to zero", () => {
    const net = computeNetBalances({
      memberIds,
      expenses: [
        { paidByMemberId: "a", amountCents: 1000, shares: splitEqual(1000, memberIds) },
        { paidByMemberId: "b", amountCents: 4500, shares: splitEqual(4500, memberIds) },
        { paidByMemberId: "c", amountCents: 7, shares: splitEqual(7, memberIds) },
      ],
      settlements: [{ fromMemberId: "c", toMemberId: "b", amountCents: 500 }],
    });
    expect(sum(Object.values(net), (v) => v)).toBe(0);
  });

  it("applies settlements in the right direction", () => {
    // b owes a $1000; paying it should zero them both out.
    const expenses = [{ paidByMemberId: "a", amountCents: 2000, shares: [{ memberId: "a", shareCents: 1000 }, { memberId: "b", shareCents: 1000 }] }];
    const before = computeNetBalances({ memberIds: ["a", "b"], expenses });
    expect(before).toEqual({ a: 1000, b: -1000 });

    const after = computeNetBalances({
      memberIds: ["a", "b"], expenses,
      settlements: [{ fromMemberId: "b", toMemberId: "a", amountCents: 1000 }],
    });
    expect(after).toEqual({ a: 0, b: 0 });
  });

  it("includes members with no activity at zero", () => {
    expect(computeNetBalances({ memberIds: ["a", "b"] })).toEqual({ a: 0, b: 0 });
  });

  it("handles a member who paid and owes nothing (covered someone else entirely)", () => {
    const net = computeNetBalances({
      memberIds: ["a", "b"],
      expenses: [{ paidByMemberId: "a", amountCents: 5000, shares: [{ memberId: "b", shareCents: 5000 }] }],
    });
    expect(net).toEqual({ a: 5000, b: -5000 });
  });
});

describe("simplifyDebts", () => {
  it("clears every balance it's given", () => {
    const net = { a: 2000, b: -1000, c: -1000 };
    const transfers = simplifyDebts(net);
    const applied = { ...net };
    for (const t of transfers) {
      applied[t.fromMemberId] += t.amountCents;
      applied[t.toMemberId] -= t.amountCents;
    }
    expect(Object.values(applied).every((v) => v === 0)).toBe(true);
  });

  it("uses at most n-1 transfers", () => {
    const net = { a: 5000, b: 3000, c: -2000, d: -1000, e: -5000 };
    expect(simplifyDebts(net).length).toBeLessThanOrEqual(Object.keys(net).length - 1);
  });

  it("nets out a circular debt into nothing", () => {
    // a owes b, b owes c, c owes a — all equal. Nobody needs to move money.
    expect(simplifyDebts({ a: 0, b: 0, c: 0 })).toEqual([]);
  });

  it("routes through the fewest hops rather than mirroring each expense", () => {
    // b owes a $10 and c owes b $10 nets to: c pays a $10. One transfer.
    const transfers = simplifyDebts({ a: 1000, b: 0, c: -1000 });
    expect(transfers).toEqual([{ fromMemberId: "c", toMemberId: "a", amountCents: 1000 }]);
  });

  it("preserves total value moved", () => {
    const net = { a: 1234, b: -500, c: -734 };
    const transfers = simplifyDebts(net);
    expect(sum(transfers, (t) => t.amountCents)).toBe(1234);
  });

  it("returns nothing when everyone is square", () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([]);
  });
});

describe("memberSummary", () => {
  it("separates what a member owes from what they're owed", () => {
    const net = { a: 2000, b: -1000, c: -1000 };
    const transfers = simplifyDebts(net);
    expect(memberSummary("a", net, transfers).owed).toHaveLength(2);
    expect(memberSummary("a", net, transfers).owes).toHaveLength(0);
    expect(memberSummary("b", net, transfers).owes).toHaveLength(1);
    expect(memberSummary("b", net, transfers).netCents).toBe(-1000);
  });
});

describe("nextOccurrence", () => {
  it("advances monthly to the target day", () => {
    const next = nextOccurrence(new Date("2026-03-05T00:00:00Z"), { interval: "MONTHLY", dayOfMonth: 15 });
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("rolls into next month when the day has passed", () => {
    const next = nextOccurrence(new Date("2026-03-20T00:00:00Z"), { interval: "MONTHLY", dayOfMonth: 15 });
    expect(next.toISOString().slice(0, 10)).toBe("2026-04-15");
  });

  it("never skips February by capping the day of month", () => {
    const next = nextOccurrence(new Date("2026-01-31T00:00:00Z"), { interval: "MONTHLY", dayOfMonth: 31 });
    // Capped to the 28th, so February still fires.
    expect(next.toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(MAX_DAY_OF_MONTH).toBe(28);
  });

  it("advances weekly to the target weekday, always in the future", () => {
    const from = new Date("2026-03-04T00:00:00Z"); // a Wednesday
    const next = nextOccurrence(from, { interval: "WEEKLY", dayOfWeek: 1 }); // Monday
    expect(next.getUTCDay()).toBe(1);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("moves forward a full week when already on the target day", () => {
    const from = new Date("2026-03-02T00:00:00Z"); // a Monday
    const next = nextOccurrence(from, { interval: "WEEKLY", dayOfWeek: 1 });
    expect(next.toISOString().slice(0, 10)).toBe("2026-03-09");
  });

  it("rejects an unknown interval rather than silently doing nothing", () => {
    expect(() => nextOccurrence(new Date(), { interval: "DAILY" })).toThrow();
  });
});

describe("periodKey", () => {
  it("is stable for the same schedule and date, so rent can't double-charge", () => {
    expect(periodKey("r1", new Date("2026-03-01T09:00:00Z"))).toBe(periodKey("r1", new Date("2026-03-01T23:00:00Z")));
  });
  it("differs across periods and schedules", () => {
    expect(periodKey("r1", "2026-03-01")).not.toBe(periodKey("r1", "2026-04-01"));
    expect(periodKey("r1", "2026-03-01")).not.toBe(periodKey("r2", "2026-03-01"));
  });
});

// The cooldown is what stops reminders becoming a harassment tool, so it gets
// the same scrutiny as the money math.
describe("canRemind cooldown", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  it("allows a first reminder", () => {
    expect(canRemind(null, now)).toEqual({ ok: true });
  });

  it("blocks a second reminder inside the window", () => {
    const r = canRemind(new Date("2026-07-29T10:00:00Z"), now);
    expect(r.ok).toBe(false);
    expect(r.hoursLeft).toBe(22);
  });

  it("allows again exactly at the boundary", () => {
    expect(canRemind(new Date("2026-07-28T12:00:00Z"), now).ok).toBe(true);
  });

  it("blocks one minute short of the boundary", () => {
    expect(canRemind(new Date("2026-07-28T12:01:00Z"), now).ok).toBe(false);
  });

  it("rounds hoursLeft up, so it never claims less time than remains", () => {
    // 10 minutes elapsed of a 24h window -> 23h50m left, reported as 24.
    expect(canRemind(new Date("2026-07-29T11:50:00Z"), now).hoursLeft).toBe(24);
  });

  it("defaults to a 24 hour window", () => {
    expect(REMIND_COOLDOWN_HOURS).toBe(24);
  });
});

describe("isOwedBy", () => {
  const transfers = [
    { fromMemberId: "b", toMemberId: "a", amountCents: 1000 },
    { fromMemberId: "c", toMemberId: "a", amountCents: 500 },
  ];

  it("confirms a creditor may remind someone who owes them", () => {
    expect(isOwedBy(transfers, "a", "b")).toBe(true);
    expect(isOwedBy(transfers, "a", "c")).toBe(true);
  });

  it("refuses the reverse direction — a debtor can't 'remind' their creditor", () => {
    expect(isOwedBy(transfers, "b", "a")).toBe(false);
  });

  it("refuses when the two aren't settled against each other at all", () => {
    expect(isOwedBy(transfers, "b", "c")).toBe(false);
  });

  it("refuses when nobody owes anything", () => {
    expect(isOwedBy([], "a", "b")).toBe(false);
  });
});
