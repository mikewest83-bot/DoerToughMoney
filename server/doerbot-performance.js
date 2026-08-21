// DoerBot performance accounting foundation.
//
// This module deliberately does NOT move money or collect fees. It records
// Alpaca equity/cash-flow snapshots and calculates performance independently
// from customer deposits/withdrawals. The 10% fee is an accrued calculation
// only; settlement stays disabled until the approved Alpaca/compliance model
// is in place.

const asCents = (value) => Math.round(Number(value || 0) * 100);

export const PERFORMANCE_FEE_RATE = 0.10;

/**
 * Cash-flow-adjusted profit for an observation interval.
 * Deposits increase equity but are not profit; withdrawals decrease equity but
 * are not losses.
 */
export function cashFlowAdjustedProfit({ beginningEquityCents, endingEquityCents, depositCents = 0, withdrawalCents = 0 }) {
  return endingEquityCents - beginningEquityCents - depositCents + withdrawalCents;
}

/**
 * Profit eligible for a high-water-mark performance fee. The high-water mark
 * is capital/performance-adjusted, never reset merely because a customer adds
 * or withdraws money.
 */
export function eligibleProfit({ equityCents, netCapitalCents, highWaterMarkCents }) {
  const adjustedEquity = equityCents - netCapitalCents;
  return Math.max(0, adjustedEquity - highWaterMarkCents);
}

export function performanceFeeCents(eligibleProfitCents, rate = PERFORMANCE_FEE_RATE) {
  return Math.max(0, Math.round(eligibleProfitCents * Number(rate)));
}

/**
 * Create the required tables without requiring a Prisma schema regeneration.
 * This is safe to run repeatedly and is intentionally separate from the
 * existing customer-money ledger.
 */
export async function ensureDoerBotPerformanceTables(prisma) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DoerBotPerformanceSnapshot" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "doerBotAccountId" TEXT NOT NULL,
      "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "equityCents" BIGINT NOT NULL,
      "cashCents" BIGINT,
      "marketValueCents" BIGINT,
      "depositCents" BIGINT NOT NULL DEFAULT 0,
      "withdrawalCents" BIGINT NOT NULL DEFAULT 0,
      "realizedPnlCents" BIGINT,
      "unrealizedPnlCents" BIGINT,
      "tradingFeesCents" BIGINT,
      "highWaterMarkCents" BIGINT NOT NULL,
      "source" TEXT NOT NULL DEFAULT 'alpaca',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "DoerBotPerformanceSnapshot_account_time_idx"
    ON "DoerBotPerformanceSnapshot" ("doerBotAccountId", "capturedAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DoerBotPerformancePeriod" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "doerBotAccountId" TEXT NOT NULL,
      "periodStart" TIMESTAMP(3) NOT NULL,
      "periodEnd" TIMESTAMP(3) NOT NULL,
      "startingEquityCents" BIGINT NOT NULL,
      "endingEquityCents" BIGINT NOT NULL,
      "depositCents" BIGINT NOT NULL DEFAULT 0,
      "withdrawalCents" BIGINT NOT NULL DEFAULT 0,
      "adjustedProfitCents" BIGINT NOT NULL,
      "returnBps" INTEGER,
      "highWaterMarkCents" BIGINT NOT NULL,
      "eligibleProfitCents" BIGINT NOT NULL DEFAULT 0,
      "performanceFeeRateBps" INTEGER NOT NULL DEFAULT 1000,
      "performanceFeeCents" BIGINT NOT NULL DEFAULT 0,
      "feeStatus" TEXT NOT NULL DEFAULT 'ACCRUED',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "DoerBotPerformancePeriod_account_period_key" UNIQUE ("doerBotAccountId", "periodEnd")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "DoerBotPerformancePeriod_user_time_idx"
    ON "DoerBotPerformancePeriod" ("userId", "periodEnd")
  `);
}

export async function recordPerformanceSnapshot(prisma, snapshot) {
  const id = snapshot.id || `dbs_${crypto.randomUUID()}`;
  await prisma.$executeRaw`
    INSERT INTO "DoerBotPerformanceSnapshot" (
      "id", "userId", "doerBotAccountId", "capturedAt", "equityCents",
      "cashCents", "marketValueCents", "depositCents", "withdrawalCents",
      "realizedPnlCents", "unrealizedPnlCents", "tradingFeesCents",
      "highWaterMarkCents", "source"
    ) VALUES (
      ${id}, ${snapshot.userId}, ${snapshot.doerBotAccountId},
      ${snapshot.capturedAt || new Date()}, ${BigInt(snapshot.equityCents)},
      ${snapshot.cashCents == null ? null : BigInt(snapshot.cashCents)},
      ${snapshot.marketValueCents == null ? null : BigInt(snapshot.marketValueCents)},
      ${BigInt(snapshot.depositCents || 0)}, ${BigInt(snapshot.withdrawalCents || 0)},
      ${snapshot.realizedPnlCents == null ? null : BigInt(snapshot.realizedPnlCents)},
      ${snapshot.unrealizedPnlCents == null ? null : BigInt(snapshot.unrealizedPnlCents)},
      ${snapshot.tradingFeesCents == null ? null : BigInt(snapshot.tradingFeesCents)},
      ${BigInt(snapshot.highWaterMarkCents)}, ${snapshot.source || "alpaca"}
    )
  `;
  return id;
}

export function alpacaAccountToSnapshot(account) {
  return {
    equityCents: asCents(account.equity),
    cashCents: asCents(account.cash),
    marketValueCents: account.portfolio_value == null ? null : asCents(account.portfolio_value),
    source: "alpaca",
  };
}
