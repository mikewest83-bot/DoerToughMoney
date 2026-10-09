import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { create: f.create } }; } }));
vi.mock("./db.js", () => ({ default: {} }));
vi.mock("./entitlements.js", () => ({ DEFAULT_STRIPE_PRICE_ID: "price_fixture" }));

describe("Managed Payments checkout", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("STRIPE_SECRET_KEY", "fixture");
    vi.stubEnv("STRIPE_PRICE_ID", "price_fixture");
    vi.stubEnv("STRIPE_MANAGED_PAYMENTS_ENABLED", "true");
    f.create.mockResolvedValue({ url: "https://checkout.stripe.com/fixture" });
  });
  const user = { id: "u1", stripeCustomerId: "cus_fixture" };
  const urls = { successUrl: "https://example.test/success", cancelUrl: "https://example.test/cancel" };
  it("uses a compatible API version only for managed checkout", async () => {
    const { createCheckoutSession } = await import("./stripe.js");
    await createCheckoutSession(user, urls);
    const [p, options] = f.create.mock.calls[0];
    expect(p.managed_payments).toEqual({ enabled: true });
    expect(p.automatic_tax).toBeUndefined();
    expect(options.apiVersion).toBe("2026-08-26.dahlia");
    expect(p.line_items).toEqual([{ price: "price_fixture", quantity: 1 }]);
    expect(p.subscription_data.metadata.userId).toBe("u1");
    expect(p.success_url).toBe(urls.successUrl);
  });
  it("preserves the old integration while activation is disabled", async () => {
    vi.stubEnv("STRIPE_MANAGED_PAYMENTS_ENABLED", "false");
    const { createCheckoutSession } = await import("./stripe.js");
    await createCheckoutSession(user, urls);
    expect(f.create.mock.calls[0][0].managed_payments).toBeUndefined();
    expect(f.create.mock.calls[0][1]).toBeUndefined();
  });
  it("does not charge users already entitled to Pro", async () => {
    const { createCheckoutSession } = await import("./stripe.js");
    expect(await createCheckoutSession({ ...user, subscriptionTier: "pro" }, urls)).toBe(urls.successUrl);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("does not fall back to an untaxed checkout on failure", async () => {
    f.create.mockRejectedValueOnce(new Error("not eligible"));
    const { createCheckoutSession } = await import("./stripe.js");
    await expect(createCheckoutSession(user, urls)).rejects.toThrow("not eligible");
    expect(f.create).toHaveBeenCalledTimes(1);
  });
});
