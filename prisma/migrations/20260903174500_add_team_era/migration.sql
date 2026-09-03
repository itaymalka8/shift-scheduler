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

-- ---------------------------------------------------------------------
-- INITIAL OWNERSHIP HISTORY FOR CLUBS THAT PREDATE THIS TABLE.
--
-- WHY IT IS HERE AND NOT IN A SEPARATE SCRIPT. Render's build runs
-- `prisma migrate deploy` BEFORE the new application version starts serving.
-- Putting these inserts in the migration means the new code never observes a
-- club without an ownership history: the table and its contents arrive
-- together, in one transaction, while the old version - which knows nothing
-- about TeamEra - is still the one serving traffic and is unaffected by a
-- new table it never reads.
--
-- WHY IT IS SAFE TO DO SO. Verified against live Production data with the
-- read-only `npm run prod:eras:classify` before this was written: 60 clubs,
-- 57 bots, 3 human (all three historical takeovers), zero anomalies, zero
-- clubs that could not be classified deterministically. The data set is
-- small, closed, and every row falls into one of the three proven shapes
-- below.
--
-- WHY THESE TIMESTAMPS ARE THE REAL ONES, not a guess. Every version of the
-- registration route since the bot-takeover path was introduced (539af06)
-- creates the User as the FIRST statement of the very transaction that
-- flips the club from bot to human, and refuses to reuse an existing user
-- (a duplicate email is rejected with 409 before the transaction opens). No
-- other code path in any commit ever writes `isBot = false` or reassigns
-- `Team.userId`. So for a taken-over club, User.createdAt IS the moment of
-- the takeover - not an approximation of it.
--
-- The three shapes, each decided by data that already exists:
--
--   1. userId IS NULL                          -> still a bot
--   2. Team.createdAt <  User.createdAt        -> taken over
--   3. Team.createdAt >= User.createdAt        -> born human
--
-- The predicates are mutually exclusive and each statement emits at most
-- one row per club, so no club can receive a duplicate era from this
-- migration. Ids are derived from the club id rather than random, so a
-- statement re-run would collide on the primary key instead of duplicating;
-- the table is created empty a few lines above, so no pre-existing row can
-- conflict either way.
--
-- A club matching NONE of the three shapes (a bot that is somehow owned, or
-- an unowned non-bot) is deliberately left with NO era rather than given a
-- guessed one. Production currently has zero of those; if one ever appears,
-- `npm run prod:eras:backfill` reports it instead of inventing history.
--
-- Every statement below is an INSERT into the table created by this same
-- migration. Nothing is deleted. No existing row, in any table, is updated.
-- ---------------------------------------------------------------------

-- 1. Still a bot: one open BOT era, from the club's own creation.
INSERT INTO "TeamEra" ("id", "teamId", "userId", "type", "startedAt", "endedAt")
SELECT 'era_bot_' || t."id", t."id", NULL, 'BOT'::"TeamEraType", t."createdAt", NULL
FROM "Team" t
WHERE t."userId" IS NULL AND t."isBot" = true;

-- 2a. Taken over: the closed BOT era, from club creation to the takeover.
INSERT INTO "TeamEra" ("id", "teamId", "userId", "type", "startedAt", "endedAt")
SELECT 'era_bot_' || t."id", t."id", NULL, 'BOT'::"TeamEraType", t."createdAt", u."createdAt"
FROM "Team" t
JOIN "User" u ON u."id" = t."userId"
WHERE t."isBot" = false AND t."createdAt" < u."createdAt";

-- 2b. Taken over: the open HUMAN era, from the takeover onwards. Its
--     startedAt is byte-identical to 2a's endedAt, so the [startedAt,
--     endedAt) windows are gapless and non-overlapping and a match kicking
--     off at that exact instant belongs to the human manager.
INSERT INTO "TeamEra" ("id", "teamId", "userId", "type", "startedAt", "endedAt")
SELECT 'era_human_' || t."id", t."id", t."userId", 'HUMAN'::"TeamEraType", u."createdAt", NULL
FROM "Team" t
JOIN "User" u ON u."id" = t."userId"
WHERE t."isBot" = false AND t."createdAt" < u."createdAt";

-- 3. Born human (an OAuth signup, or a credential signup with no free bot
--    slot): one open HUMAN era from the club's creation. There is no bot
--    phase to record because the club never had one. Production currently
--    has zero of these; the statement is here so the migration is correct
--    on any database it is applied to, including a fresh development one.
INSERT INTO "TeamEra" ("id", "teamId", "userId", "type", "startedAt", "endedAt")
SELECT 'era_human_' || t."id", t."id", t."userId", 'HUMAN'::"TeamEraType", t."createdAt", NULL
FROM "Team" t
JOIN "User" u ON u."id" = t."userId"
WHERE t."isBot" = false AND t."createdAt" >= u."createdAt";
