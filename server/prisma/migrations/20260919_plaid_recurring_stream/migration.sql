-- Plaid Recurring stream id so webhook upserts don't duplicate bills.
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "plaidStreamId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Bill_plaidStreamId_key" ON "Bill"("plaidStreamId");
