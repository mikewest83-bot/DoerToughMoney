-- Track Plaid PENDING_DISCONNECT / consent expiry so we can warn weekly.
ALTER TABLE "PlaidItem" ADD COLUMN IF NOT EXISTS "consentExpiresAt" TIMESTAMP(3);
ALTER TABLE "PlaidItem" ADD COLUMN IF NOT EXISTS "pendingDisconnectAt" TIMESTAMP(3);
ALTER TABLE "PlaidItem" ADD COLUMN IF NOT EXISTS "disconnectReason" TEXT;
ALTER TABLE "PlaidItem" ADD COLUMN IF NOT EXISTS "consentScannedAt" TIMESTAMP(3);
