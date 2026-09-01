import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// entitlements.js reads its config at import time, so each test resets the
// module registry after setting env and imports it fresh — otherwise every
// test would share whatever the first import happened to see.
const load = async (env = {}) => {
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  return import("./entitlements.js");
};

const ORIGINAL = { ...process.env };
beforeEach(() => {
  delete process.env.PAYWALL_ENABLED;
  delete process.env.FREE_BANK_LIMIT;
  delete process.env.DOERBOT_OWNER_EMAIL;
});
afterEach(() => { process.env = { ...ORIGINAL }; });

const free = { id: 1, email: "someone@example.com", subscriptionTier: null };
const pro = { id: 2, email: "payer@example.com", subscriptionTier: "pro" };

describe("paywall disarmed (no PAYWALL_ENABLED)", () => {
  it("gives everyone paid access, so the deploy is inert", async () => {
    const e = await load();
    expect(e.paywallEnabled()).toBe(false);
    expect(e.hasPaidAccess(free)).toBe(true);
    expect(e.hasPaidAccess(pro)).toBe(true);
  });

  it("does not limit banks", async () => {
    const e = await load();
    expect(e.canLinkAnotherBank(free, 99)).toBe(true);
  });
});

describe("paywall armed", () => {
  it("blocks a free user and allows a pro user", async () => {
    const e = await load({ PAYWALL_ENABLED: "1" });
    expect(e.hasPaidAccess(free)).toBe(false);
    expect(e.hasPaidAccess(pro)).toBe(true);
  });

  it("treats a missing user as unpaid rather than throwing", async () => {
    const e = await load({ PAYWALL_ENABLED: "1" });
    expect(e.hasPaidAccess(null)).toBe(false);
    expect(e.hasPaidAccess(undefined)).toBe(false);
  });

  it("lets the owner through without a subscription", async () => {
    const e = await load({ PAYWALL_ENABLED: "1", DOERBOT_OWNER_EMAIL: "Mike@Example.com" });
    expect(e.hasPaidAccess({ email: "mike@example.com", subscriptionTier: null })).toBe(true);
    // Case and surrounding whitespace must not decide entitlement — a user
    // who typed their email with a capital or a stray space is still Mike.
    expect(e.hasPaidAccess({ email: "  MIKE@EXAMPLE.COM  ", subscriptionTier: null })).toBe(true);
    expect(e.hasPaidAccess({ email: "notmike@example.com", subscriptionTier: null })).toBe(false);
  });

  it("never treats an empty owner email as matching an empty user email", async () => {
    const e = await load({ PAYWALL_ENABLED: "1" });
    expect(e.hasPaidAccess({ email: "", subscriptionTier: null })).toBe(false);
    expect(e.hasPaidAccess({ subscriptionTier: null })).toBe(false);
  });

  it("counts past_due as paid, because stripe.js already decided that", async () => {
    // stripe.js writes subscriptionTier:"pro" for past_due — Stripe is
    // mid-retry, not gone. entitlements must not re-litigate that.
    const e = await load({ PAYWALL_ENABLED: "1" });
    expect(e.isPro({ subscriptionTier: "pro" })).toBe(true);
    expect(e.isPro({ subscriptionTier: "canceled" })).toBe(false);
  });
});

describe("bank limit", () => {
  it("allows the first bank and refuses the second by default", async () => {
    const e = await load({ PAYWALL_ENABLED: "1" });
    expect(e.freeBankLimit()).toBe(1);
    expect(e.canLinkAnotherBank(free, 0)).toBe(true);
    expect(e.canLinkAnotherBank(free, 1)).toBe(false);
  });

  it("honors a configured limit", async () => {
    const e = await load({ PAYWALL_ENABLED: "1", FREE_BANK_LIMIT: "3" });
    expect(e.canLinkAnotherBank(free, 2)).toBe(true);
    expect(e.canLinkAnotherBank(free, 3)).toBe(false);
  });

  it("falls back to 1 on a garbage or zero limit rather than locking everyone out", async () => {
    expect((await load({ PAYWALL_ENABLED: "1", FREE_BANK_LIMIT: "abc" })).freeBankLimit()).toBe(1);
    expect((await load({ PAYWALL_ENABLED: "1", FREE_BANK_LIMIT: "0" })).freeBankLimit()).toBe(1);
    expect((await load({ PAYWALL_ENABLED: "1", FREE_BANK_LIMIT: "-5" })).freeBankLimit()).toBe(1);
  });

  it("never limits a paying user", async () => {
    const e = await load({ PAYWALL_ENABLED: "1" });
    expect(e.canLinkAnotherBank(pro, 50)).toBe(true);
  });
});

describe("proRequired middleware", () => {
  const mockRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };

  it("calls next() for a paying user", async () => {
    const e = await load({ PAYWALL_ENABLED: "1" });
    let called = false;
    e.proRequired({ user: pro }, mockRes(), () => { called = true; });
    expect(called).toBe(true);
  });

  it("answers 402 with a stable code the client can key off", async () => {
    const e = await load({ PAYWALL_ENABLED: "1" });
    const res = mockRes();
    let called = false;
    e.proRequired({ user: free }, res, () => { called = true; });
    expect(called).toBe(false);
    expect(res.statusCode).toBe(402);
    expect(res.body.error).toBe("upgrade_required");
  });
});
