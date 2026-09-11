-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiRequestsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAiRequestAt" TIMESTAMP(3);
