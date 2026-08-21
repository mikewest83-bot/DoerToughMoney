-- DoerBot performance ledger.
-- No customer funds are moved and no performance fee is collected by this migration.
-- Deposits/withdrawals are tracked separately from trading performance.

CREATE TABLE IF NOT EXISTS "DoerBotPerformanceSnapshot" (
  "id" TEXT NOT NULL,
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
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DoerBotPerformanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DoerBotPerformanceSnapshot_account_time_idx"
  ON "DoerBotPerformanceSnapshot" ("doerBotAccountId", "capturedAt");

CREATE TABLE IF NOT EXISTS "DoerBotPerformancePeriod" (
  "id" TEXT NOT NULL,
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
  CONSTRAINT "DoerBotPerformancePeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DoerBotPerformancePeriod_account_period_key" UNIQUE ("doerBotAccountId", "periodEnd")
);

CREATE INDEX IF NOT EXISTS "DoerBotPerformancePeriod_user_time_idx"
  ON "DoerBotPerformancePeriod" ("userId", "periodEnd");
