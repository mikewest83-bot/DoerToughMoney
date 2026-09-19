import { describe, it, expect } from "vitest";
import { classifyPlaidWebhook } from "./webhook.js";
import {
  mapPlaidFrequency,
  shouldCreateBillFromStream,
  isTombstonedStream,
} from "./recurring.js";

describe("classifyPlaidWebhook", () => {
  it("syncs transactions on default/initial/removed updates", () => {
    for (const code of ["DEFAULT_UPDATE", "INITIAL_UPDATE", "TRANSACTIONS_REMOVED"]) {
      const a = classifyPlaidWebhook({ webhook_type: "TRANSACTIONS", webhook_code: code });
      expect(a.syncTransactions).toBe(true);
      expect(a.syncRecurring).toBe(false);
    }
  });

  it("pulls recurring after historical update", () => {
    const a = classifyPlaidWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "HISTORICAL_UPDATE",
    });
    expect(a.syncTransactions).toBe(true);
    expect(a.syncRecurring).toBe(true);
  });

  it("pulls recurring when sync says historical is complete", () => {
    const a = classifyPlaidWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      historical_update_complete: true,
    });
    expect(a.syncTransactions).toBe(true);
    expect(a.syncRecurring).toBe(true);
  });

  it("does not pull recurring on a partial sync update", () => {
    const a = classifyPlaidWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      historical_update_complete: false,
    });
    expect(a.syncTransactions).toBe(true);
    expect(a.syncRecurring).toBe(false);
  });

  it("handles recurring-only webhooks without a full txn sync", () => {
    const a = classifyPlaidWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "RECURRING_TRANSACTIONS_UPDATE",
    });
    expect(a.syncTransactions).toBe(false);
    expect(a.syncRecurring).toBe(true);
  });

  it("marks reauth when login is required", () => {
    const a = classifyPlaidWebhook({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      error: { error_code: "ITEM_LOGIN_REQUIRED" },
    });
    expect(a.itemStatus).toBe("REAUTH_REQUIRED");
  });

  it("reactivates and resyncs after login repaired", () => {
    const a = classifyPlaidWebhook({
      webhook_type: "ITEM",
      webhook_code: "LOGIN_REPAIRED",
    });
    expect(a.itemStatus).toBe("ACTIVE");
    expect(a.syncTransactions).toBe(true);
  });

  it("syncs accounts when Plaid reports new ones", () => {
    const a = classifyPlaidWebhook({
      webhook_type: "ITEM",
      webhook_code: "NEW_ACCOUNTS_AVAILABLE",
    });
    expect(a.syncAccounts).toBe(true);
    expect(a.syncTransactions).toBe(false);
  });

  it("acks unknown types as a no-op", () => {
    const a = classifyPlaidWebhook({ webhook_type: "HOLDINGS", webhook_code: "DEFAULT_UPDATE" });
    expect(a.syncTransactions).toBe(false);
    expect(a.syncRecurring).toBe(false);
    expect(a.itemStatus).toBe(null);
  });
});

describe("recurring stream mapping", () => {
  it("maps Plaid frequencies onto BillCadence", () => {
    expect(mapPlaidFrequency("WEEKLY")).toBe("WEEKLY");
    expect(mapPlaidFrequency("MONTHLY")).toBe("MONTHLY");
    expect(mapPlaidFrequency("ANNUALLY")).toBe("YEARLY");
    expect(mapPlaidFrequency("BIWEEKLY")).toBe("UNKNOWN");
    expect(mapPlaidFrequency("SEMI_MONTHLY")).toBe("UNKNOWN");
  });

  it("only bills mature active outflows", () => {
    expect(shouldCreateBillFromStream({ status: "MATURE", is_active: true })).toBe(true);
    expect(shouldCreateBillFromStream({ status: "EARLY_DETECTION", is_active: true })).toBe(false);
    expect(shouldCreateBillFromStream({ status: "MATURE", is_active: false })).toBe(false);
  });

  it("treats tombstones and inactive streams as cancelled bills", () => {
    expect(isTombstonedStream({ status: "TOMBSTONED", is_active: true })).toBe(true);
    expect(isTombstonedStream({ status: "MATURE", is_active: false })).toBe(true);
    expect(isTombstonedStream({ status: "MATURE", is_active: true })).toBe(false);
  });
});
