/*
  Warnings:

  - You are about to drop the column `stadiumCapacity` on the `Team` table. All the data in the column will be lost.
  - You are about to drop the column `stadiumName` on the `Team` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "attendance" INTEGER,
ADD COLUMN     "homeRevenue" INTEGER;

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "stadiumCapacity",
DROP COLUMN "stadiumName",
ADD COLUMN     "balance" INTEGER NOT NULL DEFAULT 5000000;

-- CreateTable
CREATE TABLE "Stadium" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regularSeats" INTEGER NOT NULL,
    "coveredSeats" INTEGER NOT NULL,
    "premiumSeats" INTEGER NOT NULL,
    "vipSeats" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stadium_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StadiumConstructionJob" (
    "id" TEXT NOT NULL,
    "stadiumId" TEXT NOT NULL,
    "regularSeatsAdded" INTEGER NOT NULL DEFAULT 0,
    "coveredSeatsAdded" INTEGER NOT NULL DEFAULT 0,
    "premiumSeatsAdded" INTEGER NOT NULL DEFAULT 0,
    "vipSeatsAdded" INTEGER NOT NULL DEFAULT 0,
    "totalCost" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StadiumConstructionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Stadium_teamId_key" ON "Stadium"("teamId");

-- AddForeignKey
ALTER TABLE "Stadium" ADD CONSTRAINT "Stadium_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StadiumConstructionJob" ADD CONSTRAINT "StadiumConstructionJob_stadiumId_fkey" FOREIGN KEY ("stadiumId") REFERENCES "Stadium"("id") ON DELETE CASCADE ON UPDATE CASCADE;
