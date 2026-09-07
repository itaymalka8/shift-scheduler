-- SQUAD REPLENISHMENT + SEASON ROLL
--
-- One new offseason stage and one audit table. Nothing is dropped, no
-- existing column changes, no row is rewritten: Player, Team, Fixture,
-- YouthIntake, PlayerMatchStats and MatchEvent are untouched.
--
-- The enum value is only ADDED here, never used in this migration, so the
-- transaction Prisma wraps this file in is safe (a new enum value cannot be
-- referenced in the same transaction that creates it).

-- AlterEnum
ALTER TYPE "SeasonOffseasonStage" ADD VALUE 'SQUAD_REPLENISHMENT';

-- CreateTable
CREATE TABLE "SquadReplenishment" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "ownedBefore" INTEGER NOT NULL,
    "generated" INTEGER NOT NULL,
    "ownedAfter" INTEGER NOT NULL,
    "floorAtRun" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SquadReplenishment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SquadReplenishment_seasonId_teamId_key" ON "SquadReplenishment"("seasonId", "teamId");

-- AddForeignKey
ALTER TABLE "SquadReplenishment" ADD CONSTRAINT "SquadReplenishment_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadReplenishment" ADD CONSTRAINT "SquadReplenishment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- LEDGER ARITHMETIC, ENFORCED BY THE DATABASE.
--
-- Prisma's schema DSL has no @check attribute at this version, so these live
-- in the migration - the same place Phase 3H put YouthIntake.promotedCount's
-- 0-3 bound and Phase 3F put its retention trigger.
--
-- The identity is the point: a row claiming a club went from 14 to 18 having
-- been given 3 players is not a rounding error, it is a partially-applied
-- replenishment that somehow still wrote its ledger. The database refuses to
-- store it, so the "row exists means all the work committed" guarantee is
-- structural rather than a convention the service is trusted to keep.
ALTER TABLE "SquadReplenishment"
  ADD CONSTRAINT "SquadReplenishment_counts_nonnegative"
  CHECK ("ownedBefore" >= 0 AND "generated" >= 0 AND "ownedAfter" >= 0 AND "floorAtRun" >= 0);

ALTER TABLE "SquadReplenishment"
  ADD CONSTRAINT "SquadReplenishment_counts_balance"
  CHECK ("ownedBefore" + "generated" = "ownedAfter");
