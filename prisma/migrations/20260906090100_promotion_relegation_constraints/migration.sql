-- PROMOTION / RELEGATION - PHASE 3Q, part 2 of 2: THE INVARIANTS.
--
-- Separate from part 1 only because every statement here names a FixtureStage
-- value that part 1 added, and PostgreSQL will not let a transaction use an
-- enum value it added in that same transaction.
--
-- These are database constraints rather than application rules for the same
-- reason the shootout and playoff constraints are: a wrong value in this area
-- does not produce a visible bug. It silently sends the wrong club down.

-- ---------------------------------------------------------------------
-- 1. SHOOTOUTS ARE NOW LEGAL IN EVERY COMPETITION THAT IS NOT THE LEAGUE.
--
-- WIDENED, NOT WEAKENED. A shootout still may not appear on a LEAGUE fixture,
-- still may not be half-written, still may not be level, still may not be
-- negative - those three constraints are untouched. Only the set of
-- competitions that may hold one grows.
--
-- Written as "not the league" rather than as a list of the stages that happen
-- to exist today, so it matches canGoToShootout() in
-- src/lib/match/competition.ts exactly. A boundary decider and a promotion
-- playoff MUST produce a winner: that is the entire reason they are played.
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_shootout_decider_only_check";
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_shootout_decider_only_check"
    CHECK (
        "homeShootoutScore" IS NULL
        OR "stage" <> 'LEAGUE'::"FixtureStage"
    );

-- ---------------------------------------------------------------------
-- 2. THE BOUNDARY FIELDS BELONG TO BOUNDARY_DECIDER AND TO NOTHING ELSE.
-- Both directions, exactly as the playoff link constraints are written.
--
-- Required, because a boundary fixture that cannot say which boundary it
-- settles cannot be read back by the resolver that created it - the round
-- would be uncountable and the tie unresolvable.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_boundary_fields_required_check"
    CHECK (
        "stage" <> 'BOUNDARY_DECIDER'::"FixtureStage"
        OR ("boundaryRank" IS NOT NULL AND "boundaryRound" IS NOT NULL)
    );

-- Forbidden elsewhere, because a promotion playoff or a league match
-- carrying a boundaryRank would be a category error that reads as data.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_boundary_rank_only_check"
    CHECK ("boundaryRank" IS NULL OR "stage" = 'BOUNDARY_DECIDER'::"FixtureStage");

ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_boundary_round_only_check"
    CHECK ("boundaryRound" IS NULL OR "stage" = 'BOUNDARY_DECIDER'::"FixtureStage");

-- A rank is a table position and a round is a round. Zero and negative are
-- not merely unused, they are unstorable.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_boundary_rank_positive_check"
    CHECK ("boundaryRank" IS NULL OR "boundaryRank" >= 1);

ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_boundary_round_positive_check"
    CHECK ("boundaryRound" IS NULL OR "boundaryRound" >= 1);

-- ---------------------------------------------------------------------
-- 3. ONE PAIRING PER UNORDERED PAIR PER BOUNDARY PER ROUND.
--
-- Hand-written because Prisma can express neither a filtered index nor an
-- expression index. LEAST/GREATEST make the pair UNORDERED, so A-vs-B and
-- B-vs-A collide: a mirrored duplicate is impossible however it is reached,
-- and two concurrent runners cannot each create a fixture.
--
-- Scoped by (divisionId, boundaryRank, boundaryRound), so the same two clubs
-- may legitimately meet again in a later round of the same boundary, or in a
-- different boundary's mechanism, and only a genuine duplicate within one
-- round is refused.
CREATE UNIQUE INDEX "Fixture_boundary_pairing_key"
    ON "Fixture"(
        "divisionId",
        "boundaryRank",
        "boundaryRound",
        LEAST("homeTeamId", "awayTeamId"),
        GREATEST("homeTeamId", "awayTeamId")
    )
    WHERE "stage" = 'BOUNDARY_DECIDER'::"FixtureStage";

-- ---------------------------------------------------------------------
-- 4. THE PROMOTION BRACKET IS TWO FIXTURES, AND NEITHER MAY EXIST TWICE.
--
-- Same unordered-pair device. The bracket is A2 v B3 and B2 v A3, so the two
-- rows share a divisionId and differ in their pair - which is exactly what
-- this index keys on. A second copy of either pairing is refused by the
-- database, not by the caller remembering to check.
CREATE UNIQUE INDEX "Fixture_promotion_pairing_key"
    ON "Fixture"(
        "divisionId",
        LEAST("homeTeamId", "awayTeamId"),
        GREATEST("homeTeamId", "awayTeamId")
    )
    WHERE "stage" = 'PROMOTION_PLAYOFF'::"FixtureStage";

-- ---------------------------------------------------------------------
-- 5. A PROMOTION PLAYOFF IS NOT A CHAMPIONSHIP PLAYOFF.
-- The existing Fixture_playoff_link_only_check already says playoffId may
-- only appear on TITLE_PLAYOFF, so the new stages carry none and that rule
-- holds for them unchanged. Nothing to add: it is asserted here in a comment
-- so a future reader knows it was considered rather than forgotten.
