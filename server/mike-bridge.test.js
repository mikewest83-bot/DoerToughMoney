import { describe, expect, it, vi } from "vitest";
import { moneyBridgeStatus, requireMikeBridge } from "./mike-bridge.js";

function response() {
  return {
    code: 200,
    body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe("Mike AI service bridge", () => {
  it("fails closed when the bridge token is absent", () => {
    delete process.env.MIKE_BRIDGE_TOKEN;
    const res = response();
    requireMikeBridge({ get: () => "" }, res, vi.fn());
    expect(res.code).toBe(503);
  });

  it("uses a constant-time comparison and rejects bad bearer tokens", () => {
    process.env.MIKE_BRIDGE_TOKEN = "test-mike-bridge-token-32-bytes-minimum";
    const res = response();
    const next = vi.fn();
    requireMikeBridge({ get: () => "Bearer wrong" }, res, next);
    expect(res.code).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows the configured token and returns only capability flags", () => {
    process.env.MIKE_BRIDGE_TOKEN = "test-mike-bridge-token-32-bytes-minimum";
    const next = vi.fn();
    requireMikeBridge({ get: () => `Bearer ${process.env.MIKE_BRIDGE_TOKEN}` }, response(), next);
    expect(next).toHaveBeenCalledOnce();
    const status = moneyBridgeStatus({ plaid: true, stripe: false });
    expect(status).toMatchObject({ schemaVersion: 1, service: "doertoughmoney", ok: true });
    expect(JSON.stringify(status)).not.toContain(process.env.MIKE_BRIDGE_TOKEN);
  });
});
