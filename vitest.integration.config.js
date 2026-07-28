CREATE TABLE "PaymentLink" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountCents" INTEGER,
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentLink_slug_key" ON "PaymentLink"("slug");
CREATE INDEX "PaymentLink_userId_idx" ON "PaymentLink"("userId");
