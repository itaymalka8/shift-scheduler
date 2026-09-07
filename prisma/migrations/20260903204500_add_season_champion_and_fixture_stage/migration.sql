-- SEASON CHAMPION PERSISTENCE - PHASE 2B
--
-- Adds the permanent record of who won a division, and the discriminator
-- that keeps a championship decider out of the league table it settles.
--
-- CREATE/ALTER ONLY. No row of existing business data is written:
--   - Fixture.stage is NOT NULL with a CONSTANT default, which Postgres 11+
--     stores as catalog metadata rather than rewriting the table, so all
--     1,140 existing fixtures become LEAGUE without a single row being
--     touched or the table being locked for a rewrite.
--   - SeasonChampion is created empty. Production has no completed season,
--     so there is no historical title to reconstruct and NO BACKFILL IS
--     PERFORMED - inventing one would be inventing history.
--
-- Every foreign key below is ON DELETE RESTRICT, deliberately. A title is a
-- permanent historical fact; nothing about deleting a user, a club, a
-- season or a division may be allowed to erase one. This mirrors the
-- decision already made for TeamEra, and is the same reasoning: the
-- database states the retention rule rather than leaving it to whatever a
-- cascade happens to do.

-- CreateEnum
CREATE TYPE "FixtureStage" AS ENUM ('LEAGUE', 'TITLE_DECIDER');

-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "stage" "FixtureStage" NOT NULL DEFAULT 'LEAGUE';

-- CreateTable
CREATE TABLE "SeasonChampion" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamEraId" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "decidedByFixtureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonChampion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeasonChampion_divisionId_key" ON "SeasonChampion"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonChampion_decidedByFixtureId_key" ON "SeasonChampion"("decidedByFixtureId");

-- CreateIndex
CREATE INDEX "SeasonChampion_seasonId_idx" ON "SeasonChampion"("seasonId");

-- CreateIndex
CREATE INDEX "SeasonChampion_teamId_idx" ON "SeasonChampion"("teamId");

-- CreateIndex
CREATE INDEX "SeasonChampion_teamEraId_idx" ON "SeasonChampion"("teamEraId");

-- AddForeignKey
ALTER TABLE "SeasonChampion" ADD CONSTRAINT "SeasonChampion_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonChampion" ADD CONSTRAINT "SeasonChampion_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonChampion" ADD CONSTRAINT "SeasonChampion_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonChampion" ADD CONSTRAINT "SeasonChampion_teamEraId_fkey" FOREIGN KEY ("teamEraId") REFERENCES "TeamEra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonChampion" ADD CONSTRAINT "SeasonChampion_decidedByFixtureId_fkey" FOREIGN KEY ("decidedByFixtureId") REFERENCES "Fixture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------
-- PARTIAL UNIQUE INDEX - HAND-WRITTEN, because Prisma cannot express a
-- filtered index in schema.prisma. This is the fourth in this project;
-- the others are TransferListing_playerId_open_key,
-- Season_countryCode_active_key and TeamEra_teamId_open_key.
--
-- AT MOST ONE TITLE DECIDER PER DIVISION, EVER.
--
-- A plain UNIQUE("divisionId","stage") would be wrong in the opposite
-- direction: it would also permit only ONE LEAGUE fixture per division,
-- rejecting 379 of every division's 380 matches. The filter is what makes
-- the constraint say what is actually meant.
--
-- This is not decoration. Fixture has no unique constraint of any kind
-- today, so two overlapping cron runners reaching season-end together
-- would each create a decider and nothing in the database would object.
-- The Season row lock serialises them in practice; this index is what
-- makes a second decider impossible in principle, whatever code path is
-- taken. Phase 2C creates deciders; the invariant lands first, on purpose.
CREATE UNIQUE INDEX "Fixture_divisionId_title_decider_key"
    ON "Fixture"("divisionId")
    WHERE "stage" = 'TITLE_DECIDER'::"FixtureStage";
