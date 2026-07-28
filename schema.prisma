ALTER TABLE "Transaction"
ADD COLUMN "stripeSessionId" TEXT,
ADD COLUMN "stripeTransferId" TEXT,
ADD COLUMN "stripePayoutId" TEXT;

CREATE UNIQUE INDEX "Transaction_stripeSessionId_key" ON "Transaction"("stripeSessionId");
CREATE UNIQUE INDEX "Transaction_stripeTransferId_key" ON "Transaction"("stripeTransferId");
CREATE UNIQUE INDEX "Transaction_stripePayoutId_key" ON "Transaction"("stripePayoutId");

CREATE TABLE "StripeEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeEvent_eventId_key" ON "StripeEvent"("eventId");
