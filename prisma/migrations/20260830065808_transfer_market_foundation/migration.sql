-- CreateEnum
CREATE TYPE "PlayerCareerStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TransferListingStatus" AS ENUM ('OPEN', 'SOLD', 'CANCELLED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "careerStatus" "PlayerCareerStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "stintNumber" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "teamId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TransferWindow" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferListing" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "sellingTeamId" TEXT NOT NULL,
    "askingPrice" INTEGER NOT NULL,
    "status" "TransferListingStatus" NOT NULL DEFAULT 'OPEN',
    "windowId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferWindow_weekKey_key" ON "TransferWindow"("weekKey");

-- CreateIndex
CREATE INDEX "TransferListing_status_expiresAt_idx" ON "TransferListing"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "TransferListing_sellingTeamId_status_idx" ON "TransferListing"("sellingTeamId", "status");

-- CreateIndex
CREATE INDEX "Player_teamId_careerStatus_idx" ON "Player"("teamId", "careerStatus");

-- CreateIndex
-- Manual: Prisma's schema DSL has no partial/filtered unique index support
-- (confirmed for the installed 6.19.3), so this is not represented in
-- schema.prisma - see the comment on the TransferListing model. Enforces
-- "at most one OPEN listing per player" at the database level, not just in
-- application code.
CREATE UNIQUE INDEX "TransferListing_playerId_open_key" ON "TransferListing"("playerId") WHERE "status" = 'OPEN'::"TransferListingStatus";

-- AddForeignKey
ALTER TABLE "TransferListing" ADD CONSTRAINT "TransferListing_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferListing" ADD CONSTRAINT "TransferListing_sellingTeamId_fkey" FOREIGN KEY ("sellingTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferListing" ADD CONSTRAINT "TransferListing_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "TransferWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
