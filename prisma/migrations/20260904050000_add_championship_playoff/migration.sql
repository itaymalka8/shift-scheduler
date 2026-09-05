-- MULTI-TEAM CHAMPIONSHIP PLAYOFF - PHASE 2D, part 1 of 2.
--
-- Structure only. The CHECK constraints and the partial unique index that
-- REFERENCE 'TITLE_PLAYOFF' are deliberately in a second migration, because
-- Postgres refuses to use a new enum value in the same transaction that adds
-- it ("unsafe use of new value of enum type"). Prisma runs each migration in
-- one transaction, so the value has to be committed before anything can
-- mention it.
--
-- ADDITIVE ONLY. The three new Fixture columns are nullable with no default,
-- so adding them is catalog metadata: not one of the 1,140 existing fixture
-- rows is read or written, and every one keeps NULL on all three - which is
-- the correct value, since none of them is a playoff fixture.
-- ChampionshipPlayoff is created empty. There is no backfill: Production has
-- never had a tie, so there is no historical playoff to reconstruct.
--
-- Every foreign key is ON DELETE RESTRICT. A playoff is the evidence behind a
-- championship, and the draw it carries is a permanent sporting fact.

-- CreateEnum
CREATE TYPE "PlayoffPhase" AS ENUM ('ROUND_ROBIN', 'KNOCKOUT');

-- AlterEnum
ALTER TYPE "FixtureStage" ADD VALUE 'TITLE_PLAYOFF';

-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "playoffId" TEXT,
ADD COLUMN     "playoffPhase" "PlayoffPhase",
ADD COLUMN     "playoffRound" INTEGER;

-- CreateTable
CREATE TABLE "ChampionshipPlayoff" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "drawSeed" TEXT NOT NULL,
    "knockoutDraw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChampionshipPlayoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChampionshipPlayoff_divisionId_key" ON "ChampionshipPlayoff"("divisionId");

-- CreateIndex
CREATE INDEX "ChampionshipPlayoff_seasonId_idx" ON "ChampionshipPlayoff"("seasonId");

-- AddForeignKey
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_playoffId_fkey" FOREIGN KEY ("playoffId") REFERENCES "ChampionshipPlayoff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionshipPlayoff" ADD CONSTRAINT "ChampionshipPlayoff_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionshipPlayoff" ADD CONSTRAINT "ChampionshipPlayoff_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

