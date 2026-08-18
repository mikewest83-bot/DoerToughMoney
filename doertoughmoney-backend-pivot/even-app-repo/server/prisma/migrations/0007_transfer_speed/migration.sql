-- CreateEnum
CREATE TYPE "TransferSpeed" AS ENUM ('STANDARD', 'EXPRESS');

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "expediteFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "speed" "TransferSpeed" NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "fundingSourceChannels" TEXT[] DEFAULT ARRAY[]::TEXT[];

