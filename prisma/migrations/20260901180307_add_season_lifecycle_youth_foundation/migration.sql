-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('ACTIVE', 'OFFSEASON', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SeasonOffseasonStage" AS ENUM ('NONE', 'PLAYER_LIFECYCLE', 'YOUTH_GENERATION', 'BOT_PROMOTION', 'WAITING_HUMANS', 'CREATE_NEXT', 'DONE');

-- CreateEnum
CREATE TYPE "YouthIntakeStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "YouthProspectStatus" AS ENUM ('PENDING', 'PROMOTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "offseasonStage" "SeasonOffseasonStage" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "status" "SeasonStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "YouthIntake" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "status" "YouthIntakeStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "promotedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouthIntake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouthProspect" (
    "id" TEXT NOT NULL,
    "youthIntakeId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "nationality" TEXT NOT NULL,
    "primaryPosition" TEXT NOT NULL,
    "secondaryPositions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredFoot" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "potential" INTEGER NOT NULL,
    "shooting" INTEGER,
    "finishing" INTEGER,
    "longShots" INTEGER,
    "heading" INTEGER,
    "attackingPositioning" INTEGER,
    "passing" INTEGER,
    "longPassing" INTEGER,
    "vision" INTEGER,
    "technique" INTEGER,
    "creativity" INTEGER,
    "dribbling" INTEGER,
    "ballControl" INTEGER,
    "crossing" INTEGER,
    "freeKicks" INTEGER,
    "penalties" INTEGER,
    "corners" INTEGER,
    "tackling" INTEGER,
    "marking" INTEGER,
    "defensivePositioning" INTEGER,
    "interceptions" INTEGER,
    "aerialDuels" INTEGER,
    "pace" INTEGER,
    "acceleration" INTEGER,
    "strength" INTEGER,
    "stamina" INTEGER,
    "agility" INTEGER,
    "balance" INTEGER,
    "jumping" INTEGER,
    "leadership" INTEGER,
    "composure" INTEGER,
    "decisions" INTEGER,
    "anticipation" INTEGER,
    "teamwork" INTEGER,
    "workRate" INTEGER,
    "concentration" INTEGER,
    "aggression" INTEGER,
    "experience" INTEGER,
    "secondBallAwareness" INTEGER,
    "goalkeeping" INTEGER,
    "reflexes" INTEGER,
    "handling" INTEGER,
    "diving" INTEGER,
    "oneOnOne" INTEGER,
    "aerialAbility" INTEGER,
    "goalkeeperPositioning" INTEGER,
    "distribution" INTEGER,
    "penaltySaving" INTEGER,
    "status" "YouthProspectStatus" NOT NULL DEFAULT 'PENDING',
    "promotedPlayerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedAt" TIMESTAMP(3),

    CONSTRAINT "YouthProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerSeasonLifecycle" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerSeasonLifecycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YouthIntake_status_closesAt_idx" ON "YouthIntake"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "YouthIntake_teamId_seasonId_key" ON "YouthIntake"("teamId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "YouthProspect_promotedPlayerId_key" ON "YouthProspect"("promotedPlayerId");

-- CreateIndex
CREATE INDEX "YouthProspect_youthIntakeId_status_idx" ON "YouthProspect"("youthIntakeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeasonLifecycle_seasonId_playerId_key" ON "PlayerSeasonLifecycle"("seasonId", "playerId");

-- AddForeignKey
ALTER TABLE "YouthIntake" ADD CONSTRAINT "YouthIntake_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouthIntake" ADD CONSTRAINT "YouthIntake_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouthProspect" ADD CONSTRAINT "YouthProspect_youthIntakeId_fkey" FOREIGN KEY ("youthIntakeId") REFERENCES "YouthIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouthProspect" ADD CONSTRAINT "YouthProspect_promotedPlayerId_fkey" FOREIGN KEY ("promotedPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSeasonLifecycle" ADD CONSTRAINT "PlayerSeasonLifecycle_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSeasonLifecycle" ADD CONSTRAINT "PlayerSeasonLifecycle_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Manual addition (not generated by Prisma - its schema DSL has no partial/
-- filtered unique index support as of this Prisma version, same limitation
-- already documented on TransferListing's single-OPEN-per-player rule in
-- prisma/schema.prisma). Enforces: at most one Season per countryCode may
-- have isActive = true. A future `prisma migrate dev` diff must not be
-- allowed to "fix" this apparent drift by dropping it - always review a
-- generated migration diff before applying it.
CREATE UNIQUE INDEX "Season_countryCode_active_key"
ON "Season" ("countryCode")
WHERE "isActive" = true;

-- Manual addition (not generated by Prisma - no @check attribute in this
-- Prisma version). Bounds YouthIntake.promotedCount to the game rule of at
-- most 3 promotions per intake, never negative.
ALTER TABLE "YouthIntake"
ADD CONSTRAINT "YouthIntake_promotedCount_check"
CHECK ("promotedCount" >= 0 AND "promotedCount" <= 3);
