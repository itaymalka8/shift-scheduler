-- TeamEra: who was managing this club, and when.
--
-- ADDITIVE ONLY. This migration creates one enum, one table, its indexes
-- and its constraints. It does not drop, alter or delete anything, and it
-- does not touch a single existing row: no fixture, no team, no score, no
-- balance, no squad, no stadium, no standing. The backfill that populates
-- this table for existing clubs is deliberately NOT here - it is a separate,
-- reviewable, idempotent script (scripts/production/backfill-team-eras.ts),
-- so that creating the structure and interpreting existing data are two
-- decisions that can be made, and rolled back, independently.

-- CreateEnum
CREATE TYPE "TeamEraType" AS ENUM ('BOT', 'HUMAN');

-- CreateTable
CREATE TABLE "TeamEra" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "TeamEraType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "startedSeasonId" TEXT,
    "endedSeasonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamEra_teamId_startedAt_idx" ON "TeamEra"("teamId", "startedAt");

-- CreateIndex
CREATE INDEX "TeamEra_userId_startedAt_idx" ON "TeamEra"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "TeamEra" ADD CONSTRAINT "TeamEra_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEra" ADD CONSTRAINT "TeamEra_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEra" ADD CONSTRAINT "TeamEra_startedSeasonId_fkey" FOREIGN KEY ("startedSeasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEra" ADD CONSTRAINT "TeamEra_endedSeasonId_fkey" FOREIGN KEY ("endedSeasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------
-- THE ONE-OPEN-ERA INVARIANT, ENFORCED BY THE DATABASE.
--
-- At most one era per club may be open (endedAt IS NULL). Prisma's schema
-- DSL cannot express a partial/filtered unique index (still true as of
-- Prisma 6.19.3), so this is hand-written here - exactly as
-- TransferListing_playerId_open_key and Season_countryCode_active_key
-- already are in earlier migrations.
--
-- It has no schema.prisma representation. A future `prisma migrate dev`
-- must NOT be allowed to "fix" the resulting apparent drift by dropping it;
-- always review a generated migration diff before applying it. The comment
-- on model TeamEra in schema.prisma says the same thing at the other end.
--
-- This is a plain index, not a deferrable constraint, so it is enforced per
-- statement: a takeover must therefore close the outgoing era BEFORE
-- inserting the incoming one, which is the order closeEraAndOpenNext uses
-- (src/lib/teams/eras.ts).
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX "TeamEra_teamId_open_key" ON "TeamEra"("teamId") WHERE "endedAt" IS NULL;

-- An era cannot end before, or at, the instant it began. Zero-length eras
-- are what a double-takeover in the same millisecond would produce, and
-- they would make a fixture's attribution ambiguous.
ALTER TABLE "TeamEra" ADD CONSTRAINT "TeamEra_period_check" CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt");

-- A HUMAN era always names its manager; a BOT era never does. Without this,
-- a HUMAN era with a null userId would be a stretch of history belonging to
-- nobody, and a BOT era with a userId would silently credit a person for
-- matches a bot played.
ALTER TABLE "TeamEra" ADD CONSTRAINT "TeamEra_user_matches_type_check" CHECK (
    ("type" = 'HUMAN' AND "userId" IS NOT NULL) OR ("type" = 'BOT' AND "userId" IS NULL)
);
