import { describe, it, expect } from "vitest";
import {
  toCents, dollars, validateAmount, cleanHandle,
  txnDirection, shapeTxn, idempotencyDecision, computeFee,
} from "./logic.js";

describe("toCents", () => {
  it("converts whole and fractional dollars", () => {
    expect(toCents(10)).toBe(1000);
    expect(toCents("10.50")).toBe(1050);
    expect(toCents(0.01)).toBe(1);
  });
  it("rounds to the nearest cent (no float drift)", () => {
    expect(toCents(10.555)).toBe(1056);
    expect(toCents(0.1 + 0.2)).toBe(30); // classic 0.30000000000000004
  });
  it("returns NaN for junk", () => {
    expect(Number.isNaN(toCents("abc"))).toBe(true);
    expect(Number.isNaN(toCents(Infinity))).toBe(true);
  });
});

describe("dollars", () => {
  it("is the inverse of toCents for clean values", () => {
    expect(dollars(1234)).toBe(12.34);
  });
});

describe("validateAmount", () => {
  it("accepts positive amounts", () => {
    expect(validateAmount("12.34")).toEqual({ ok: true, cents: 1234 });
  });
  it("rejects amounts over the transaction limit", () => {
    expect(validateAmount("10000.01").ok).toBe(false);
  });
  it("rejects zero, negatives, and junk", () => {
    for (const bad of ["0", "-5", "", "abc", null, undefined]) {
      expect(validateAmount(bad).ok).toBe(false);
    }
  });
});

describe("cleanHandle", () => {
  it("adds a leading @ and trims", () => {
    expect(cleanHandle("bob")).toBe("@bob");
    expect(cleanHandle("@bob")).toBe("@bob");
    expect(cleanHandle("  bob ")).toBe("@bob");
    expect(cleanHandle("")).toBe("");
  });
});

describe("txnDirection / shapeTxn", () => {
  const me = "u_me";
  const row = (over) => ({
    id: "t1", kind: "pay", status: "POSTED", amountCents: 2500,
    note: "🌮", createdAt: 0,
    fromUserId: "u_them", toUserId: me,
    fromUser: { name: "Sam", handle: "@sam" }, toUser: { name: "Me", handle: "@me" },
    ...over,
  });

  it("marks money received as 'in' and shows the other party", () => {
    const s = shapeTxn(row(), me);
    expect(s.dir).toBe("in");
    expect(s.who).toBe("Sam");
    expect(s.amount).toBe(25);
  });
  it("marks money sent as 'out'", () => {
    const s = shapeTxn(row({ fromUserId: me, toUserId: "u_them" }), me);
    expect(s.dir).toBe("out");
    expect(s.who).toBe("Me"); // "other" party is the toUser here
  });
  it("shows the requester and payer sides correctly", () => {
    expect(txnDirection({ kind: "request", fromUserId: "payer", toUserId: me }, me)).toBe("requested");
    expect(txnDirection({ kind: "request", fromUserId: me, toUserId: "requester" }, me)).toBe("request_due");
  });
});

describe("idempotencyDecision", () => {
  it("proceeds when no key exists", () => {
    expect(idempotencyDecision(null)).toEqual({ action: "proceed" });
  });
  it("409s while a request is in flight (status 0)", () => {
    const d = idempotencyDecision({ status: 0 });
    expect(d.action).toBe("conflict");
    expect(d.status).toBe(409);
  });
  it("replays the stored response for a completed key", () => {
    const d = idempotencyDecision({ status: 200, response: { user: { id: "u1" } } });
    expect(d.action).toBe("replay");
    expect(d.status).toBe(200);
    expect(d.body).toEqual({ user: { id: "u1" } });
  });
});

describe("computeFee", () => {
  it("is zero when the platform fee is turned off", () => {
    expect(computeFee(10000, {})).toBe(0);
    expect(computeFee(10000, { bps: 0, flatCents: 0 })).toBe(0);
  });
  it("charges a percentage in basis points", () => {
    expect(computeFee(10000, { bps: 150 })).toBe(150); // 1.5% of $100 = $1.50
    expect(computeFee(2500, { bps: 150 })).toBe(38);   // 1.5% of $25 rounds to 38c
  });
  it("adds a flat component and respects a cap", () => {
    expect(computeFee(10000, { bps: 150, flatCents: 25 })).toBe(175);
    expect(computeFee(10000, { bps: 150, flatCents: 25, capCents: 100 })).toBe(100);
  });
  it("never returns a negative or non-finite fee", () => {
    expect(computeFee(0, { bps: 150 })).toBe(0);
    expect(computeFee(-500, { bps: 150 })).toBe(0);
    expect(computeFee(NaN, { bps: 150 })).toBe(0);
  });
});

// The express upgrade prices the same way as the base fee, just with its own
// params, so a payment's total is base + expedite (expedite only when chosen).
describe("express (expedite) fee pricing", () => {
  const base = { bps: 0, flatCents: 0 };            // standard sends free
  const expedite = { bps: 175, flatCents: 0 };      // 1.75% for speed

  it("charges nothing extra on a standard send", () => {
    expect(computeFee(5000, base)).toBe(0);
  });
  it("charges the expedite rate on top when express is chosen", () => {
    expect(computeFee(5000, base) + computeFee(5000, expedite)).toBe(88); // 1.75% of $50
    expect(computeFee(2000, base) + computeFee(2000, expedite)).toBe(35); // 1.75% of $20
  });
  it("respects an expedite cap so large sends don't get a huge speed fee", () => {
    expect(computeFee(1000000, { ...expedite, capCents: 1500 })).toBe(1500);
  });
  it("supports flat-fee pricing for speed", () => {
    expect(computeFee(2500, { bps: 0, flatCents: 50 })).toBe(50);
    expect(computeFee(100000, { bps: 0, flatCents: 50 })).toBe(50);
  });
});
