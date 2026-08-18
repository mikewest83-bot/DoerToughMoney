-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'RETRY', 'DOCUMENT', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'RETURNED');

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_fromUserId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_toUserId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "balanceCents",
DROP COLUMN "stripeAccountId",
ADD COLUMN     "dwollaCustomerUrl" TEXT,
ADD COLUMN     "fundingSourceUrl" TEXT,
ADD COLUMN     "fundingSourceVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING';

-- DropTable
DROP TABLE "PaymentLink";

-- DropTable
DROP TABLE "StripeEvent";

-- DropTable
DROP TABLE "Transaction";

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "providerUrl" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "feeCollected" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Request" (
    "id" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_idempotencyKey_key" ON "Transfer"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_providerRef_key" ON "Transfer"("providerRef");

-- CreateIndex
CREATE INDEX "Transfer_senderId_idx" ON "Transfer"("senderId");

-- CreateIndex
CREATE INDEX "Transfer_recipientId_idx" ON "Transfer"("recipientId");

-- CreateIndex
CREATE INDEX "Request_payerId_idx" ON "Request"("payerId");

-- CreateIndex
CREATE INDEX "Request_requesterId_idx" ON "Request"("requesterId");

-- CreateIndex
CREATE UNIQUE INDEX "User_dwollaCustomerUrl_key" ON "User"("dwollaCustomerUrl");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

