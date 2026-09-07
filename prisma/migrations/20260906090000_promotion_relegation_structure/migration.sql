-- PROMOTION / RELEGATION - PHASE 3Q, part 1 of 2: STRUCTURE.
--
-- Split from part 2 for one reason only: PostgreSQL refuses to USE an enum
-- value in the same transaction that ADDED it, and Prisma runs a migration
-- file as one transaction. Every statement here therefore names only enum
-- values that already exist; every statement that names a new one lives in
-- part 2. Phase 2D's add_championship_playoff pair was split for exactly
-- this reason and says so in its own header.
--
-- Nothing here rewrites a played row. The only data written is a backfill of
-- a new column from the value it is denormalised from, and it refuses to
-- proceed if that backfill reveals a state the new constraint would forbid.

-- ---------------------------------------------------------------------
-- 1. THE OFFSEASON GAINS A MEMBERSHIP STAGE.
-- Between SQUAD_REPLENISHMENT and CREATE_NEXT: after every club's roster is
-- final, before a single fixture of the next season is written. It creates
-- no sporting fixture - every match that could change who goes up or down
-- was played while season N was still ACTIVE.
ALTER TYPE "SeasonOffseasonStage" ADD VALUE 'PROMOTION_RELEGATION' AFTER 'SQUAD_REPLENISHMENT';

-- ---------------------------------------------------------------------
-- 2. TWO NEW COMPETITIONS.
-- FixtureStage is this codebase's canonical competition discriminator, and
-- it is deliberately consulted as "not the league" rather than as a list of
-- known values (src/lib/match/competition.ts), so both of these inherit
-- neutral venue, no club finances and shootout eligibility on the day they
-- are added rather than on the day somebody remembers a list.
ALTER TYPE "FixtureStage" ADD VALUE 'BOUNDARY_DECIDER';
ALTER TYPE "FixtureStage" ADD VALUE 'PROMOTION_PLAYOFF';

-- ---------------------------------------------------------------------
-- 3. WHICH BOUNDARY, AND WHICH ROUND OF IT.
-- Nullable columns; part 2 makes them required on BOUNDARY_DECIDER and
-- forbidden everywhere else.
ALTER TABLE "Fixture" ADD COLUMN "boundaryRank" INTEGER;
ALTER TABLE "Fixture" ADD COLUMN "boundaryRound" INTEGER;

-- ---------------------------------------------------------------------
-- 4. ONE DIVISION PER CLUB PER SEASON, AS A DATABASE FACT.
--
-- DivisionTeam_divisionId_teamId_key forbids a club appearing twice in one
-- division. It does not forbid a club appearing in two divisions of the same
-- season: those are different divisionIds, so the index is satisfied by a
-- row asserting a club is in both the top flight and the second tier at
-- once. Unreachable while the only writer copied a partition; reachable the
-- moment a movement stage can be retried.
ALTER TABLE "DivisionTeam" ADD COLUMN "seasonId" TEXT;

UPDATE "DivisionTeam" dt
   SET "seasonId" = d."seasonId"
  FROM "Division" d
 WHERE d."id" = dt."divisionId";

-- GATE 1: nothing may be left unattributed. A NULL here after the backfill
-- means a membership row points at a division that does not exist, which is
-- impossible under the existing FK - so if it fires, something is wrong that
-- this migration must not paper over.
DO $$
DECLARE unattributed bigint;
BEGIN
  SELECT count(*) INTO unattributed FROM "DivisionTeam" WHERE "seasonId" IS NULL;
  IF unattributed > 0 THEN
    RAISE EXCEPTION 'DivisionTeam backfill incomplete: % row(s) have no seasonId', unattributed;
  END IF;
END $$;

-- GATE 2: the constraint about to be created must ALREADY be true. If any
-- club is in two divisions of one season today, this migration fails and the
-- state is investigated - never "fixed" by deleting a row it cannot judge.
DO $$
DECLARE contradictions bigint;
BEGIN
  SELECT count(*) INTO contradictions
    FROM (SELECT "seasonId", "teamId" FROM "DivisionTeam"
           GROUP BY 1, 2 HAVING count(*) > 1) duplicated;
  IF contradictions > 0 THEN
    RAISE EXCEPTION
      'DivisionTeam contradiction: % (season, team) pair(s) appear in more than one division', contradictions;
  END IF;
END $$;

ALTER TABLE "DivisionTeam" ALTER COLUMN "seasonId" SET NOT NULL;

-- RESTRICT, and deliberately stronger than the path it shadows: Division ->
-- Season is Cascade and DivisionTeam -> Division is Cascade, so deleting a
-- Season would otherwise cascade away the league's entire membership
-- history. Today that is blocked only incidentally, by Fixture_divisionId_fkey
-- being RESTRICT, which protects nothing for a division with no fixtures.
ALTER TABLE "DivisionTeam"
  ADD CONSTRAINT "DivisionTeam_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No separate index on seasonId alone: the unique below is a btree on
-- (seasonId, teamId), whose leftmost column already serves every
-- season-scoped membership lookup. A second index would be dead weight on
-- every write.

-- The constraint this whole section exists for.
CREATE UNIQUE INDEX "DivisionTeam_seasonId_teamId_key" ON "DivisionTeam"("seasonId", "teamId");

-- DivisionTeam_divisionId_teamId_key is KEPT, not replaced. It is the
-- conflict target createMany({ skipDuplicates }) resolves against on the
-- divisionId path - which is how the idempotent membership write no-ops on
-- retry - and it indexes (divisionId, teamId) leftmost-by-division, which
-- the new index cannot serve. The two forbid different things.
