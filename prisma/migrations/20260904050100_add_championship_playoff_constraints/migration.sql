-- MULTI-TEAM CHAMPIONSHIP PLAYOFF - PHASE 2D, part 2 of 2.
--
-- The invariants. Separate from part 1 only because every statement here
-- mentions 'TITLE_PLAYOFF', which Postgres will not let a transaction use in
-- the same transaction that added it to the enum.
--
-- These are database constraints rather than application rules for the same
-- reason the shootout constraints are: a wrong value in this area does not
-- produce a visible bug, it silently names the wrong club champion, in
-- records whose entire purpose is to be trusted forever.

-- ---------------------------------------------------------------------
-- 1. EVERY TITLE_PLAYOFF FIXTURE BELONGS TO A PLAYOFF, AND NOTHING ELSE DOES.
-- Both directions. A playoff fixture with no competition is an orphan; a
-- league fixture pointing at a playoff is a category error. The two-club
-- TITLE_DECIDER deliberately falls under the second rule - it is one match,
-- not a competition, and keeps no playoffId.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_playoff_link_required_check"
    CHECK ("stage" <> 'TITLE_PLAYOFF'::"FixtureStage" OR "playoffId" IS NOT NULL);

ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_playoff_link_only_check"
    CHECK ("playoffId" IS NULL OR "stage" = 'TITLE_PLAYOFF'::"FixtureStage");

-- ---------------------------------------------------------------------
-- 2. A PLAYOFF FIXTURE ALWAYS KNOWS WHICH ROUND OF WHICH PHASE IT IS.
-- Without both, a fixture cannot be placed in the competition, the pairing
-- invariant below cannot scope itself, and the round-robin cap cannot apply.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_playoff_phase_round_check"
    CHECK (
        "stage" <> 'TITLE_PLAYOFF'::"FixtureStage"
        OR ("playoffPhase" IS NOT NULL AND "playoffRound" IS NOT NULL)
    );

ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_playoff_phase_only_check"
    CHECK ("playoffPhase" IS NULL OR "stage" = 'TITLE_PLAYOFF'::"FixtureStage");

ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_playoff_round_only_check"
    CHECK ("playoffRound" IS NULL OR "stage" = 'TITLE_PLAYOFF'::"FixtureStage");

ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_playoff_round_positive_check"
    CHECK ("playoffRound" IS NULL OR "playoffRound" >= 1);

-- ---------------------------------------------------------------------
-- 3. THE ROUND-ROBIN CAP IS A DATABASE FACT, NOT A CODE CONVENTION.
-- Three rounds, then the knockout. A fourth round-robin round is UNSTORABLE,
-- so the only way past round 3 is the knockout - which is what makes the
-- termination proof a property of the database rather than of a loop guard
-- somebody could later edit.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_playoff_round_robin_cap_check"
    CHECK (
        "playoffPhase" IS DISTINCT FROM 'ROUND_ROBIN'::"PlayoffPhase"
        OR "playoffRound" <= 3
    );

-- ---------------------------------------------------------------------
-- 4. ONE PAIRING PER UNORDERED PAIR PER ROUND.
-- Hand-written because Prisma can express neither a filtered index nor an
-- expression index. LEAST/GREATEST make the pair UNORDERED, so A-vs-B and
-- B-vs-A collide: a mirrored duplicate is impossible however it is reached,
-- and two concurrent runners cannot produce a fixture each.
--
-- Scoped by (playoffId, phase, round), so the same two clubs may legitimately
-- meet again in a later round or in the knockout, and only a genuine
-- duplicate within one round is refused.
--
-- This covers the knockout too: within a single knockout round a club appears
-- at most once, so a knockout pairing is the same shape of fact.
CREATE UNIQUE INDEX "Fixture_playoff_pairing_key"
    ON "Fixture"(
        "playoffId",
        "playoffPhase",
        "playoffRound",
        LEAST("homeTeamId", "awayTeamId"),
        GREATEST("homeTeamId", "awayTeamId")
    )
    WHERE "stage" = 'TITLE_PLAYOFF'::"FixtureStage";

-- ---------------------------------------------------------------------
-- 5. SHOOTOUTS ARE NOW LEGAL IN THE PLAYOFF TOO.
-- Widened, not weakened: a shootout still may not appear on a LEAGUE fixture,
-- still may not be half-written, still may not be level, still may not be
-- negative. Only the set of competitions that can hold one has grown.
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_shootout_decider_only_check";
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_shootout_decider_only_check"
    CHECK (
        "homeShootoutScore" IS NULL
        OR "stage" IN ('TITLE_DECIDER'::"FixtureStage", 'TITLE_PLAYOFF'::"FixtureStage")
    );
