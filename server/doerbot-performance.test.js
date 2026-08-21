import { describe, expect, it } from "vitest";
import {
  cashFlowAdjustedProfit,
  eligibleProfit,
  performanceFeeCents,
} from "./doerbot-performance.js";

describe("DoerBot performance accounting", () => {
  it("excludes deposits from trading profit", () => {
    expect(cashFlowAdjustedProfit({
      beginningEquityCents: 500_000,
      endingEquityCents: 710_000,
      depositCents: 200_000,
    })).toBe(10_000);
  });

  it("excludes withdrawals from trading loss", () => {
    expect(cashFlowAdjustedProfit({
      beginningEquityCents: 500_000,
      endingEquityCents: 450_000,
      withdrawalCents: 75_000,
    })).toBe(25_000);
  });

  it("charges only new profit above the high-water mark", () => {
    expect(eligibleProfit({
      equityCents: 505_000,
      netCapitalCents: 0,
      highWaterMarkCents: 500_000,
    })).toBe(5_000);
  });

  it("does not charge while recovering a drawdown", () => {
    expect(eligibleProfit({
      equityCents: 495_000,
      netCapitalCents: 0,
      highWaterMarkCents: 500_000,
    })).toBe(0);
  });

  it("calculates the 10 percent fee on eligible profit only", () => {
    expect(performanceFeeCents(12_345, 0.10)).toBe(1_235);
  });
});
