-- Fee taken on a payment, in cents (0 when fees are off).
ALTER TABLE "Transaction" ADD COLUMN "feeCents" INTEGER NOT NULL DEFAULT 0;

-- Account that collects platform fees. Login is disabled (unusable hash).
INSERT INTO "User" ("id", "name", "handle", "email", "passwordHash", "balanceCents", "createdAt")
VALUES ('u_platform', 'even', '@even', 'platform@even.local', '!', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
