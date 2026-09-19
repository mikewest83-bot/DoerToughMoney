import { describe, it, expect } from "vitest";
import {
  needsWeeklyConsentScan,
  parseDisconnectDeadline,
  webhookConsentPatch,
  CONSENT_SCAN_MS,
} from "./consent.js";

describe("PENDING_DISCONNECT tracking", () => {
  it("reads US/CA disconnect_time", () => {
    const d = parseDisconnectDeadline({ disconnect_time: "2026-09-26T13:00:00.000Z" });
    expect(d.toISOString()).toBe("2026-09-26T13:00:00.000Z");
  });

  it("reads UK/EU consent_expiration_time", () => {
    const d = parseDisconnectDeadline({ consent_expiration_time: "2026-10-01T00:00:00.000Z" });
    expect(d.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("stores the webhook timestamp and reason on PENDING_DISCONNECT", () => {
    const patch = webhookConsentPatch(
      {
        webhook_code: "PENDING_DISCONNECT",
        disconnect_time: "2026-09-26T13:00:00.000Z",
        reason: "INSTITUTION_TOKEN_EXPIRATION",
      },
      { itemStatus: "REAUTH_REQUIRED" },
    );
    expect(patch.consentExpiresAt.toISOString()).toBe("2026-09-26T13:00:00.000Z");
    expect(patch.disconnectReason).toBe("INSTITUTION_TOKEN_EXPIRATION");
    expect(patch.pendingDisconnectAt).toBeInstanceOf(Date);
  });

  it("clears the pending flag when login is repaired", () => {
    const patch = webhookConsentPatch({ webhook_code: "LOGIN_REPAIRED" }, { itemStatus: "ACTIVE" });
    expect(patch.pendingDisconnectAt).toBe(null);
    expect(patch.disconnectReason).toBe(null);
  });

  it("scans again after a week, not before", () => {
    const now = Date.parse("2026-09-19T15:00:00.000Z");
    expect(needsWeeklyConsentScan({ consentScannedAt: null }, now)).toBe(true);
    expect(needsWeeklyConsentScan({ consentScannedAt: new Date(now - CONSENT_SCAN_MS) }, now)).toBe(true);
    expect(needsWeeklyConsentScan({ consentScannedAt: new Date(now - CONSENT_SCAN_MS + 60_000) }, now)).toBe(false);
  });
});
