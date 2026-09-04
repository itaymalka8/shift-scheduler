-- TITLE DECIDER - PENALTY SHOOTOUT PERSISTENCE (Phase 2C)
--
-- Two nullable columns, and three CHECK constraints that make every invalid
-- combination unstorable.
--
-- ADDITIVE ONLY. Both columns are nullable with no default, so adding them
-- is catalog metadata in Postgres - not one of the 1,140 existing fixture
-- rows is read or written, and every one of them keeps NULL on both, which
-- is the correct value: none of them was a penalty shootout.
--
-- The constraints are in the database rather than in application code
-- because a wrong value in these two columns does not cause a visible bug -
-- it silently names the wrong club as champion, permanently, in a table
-- whose entire purpose is to be trusted forever.

-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "awayShootoutScore" INTEGER,
ADD COLUMN     "homeShootoutScore" INTEGER;


-- ---------------------------------------------------------------------
-- 1. BOTH OR NEITHER.
-- A shootout produces two scores or it did not happen. One score alone is
-- a half-written result, and half a result is worse than none.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_shootout_both_or_neither_check"
    CHECK (
        ("homeShootoutScore" IS NULL AND "awayShootoutScore" IS NULL)
        OR ("homeShootoutScore" IS NOT NULL AND "awayShootoutScore" IS NOT NULL)
    );

-- 2. TITLE DECIDERS ONLY.
-- A league match cannot go to penalties in this game, so a league row
-- carrying a shootout score is a bug by definition. Stated here so the bug
-- cannot reach the table at all rather than being found later in a report.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_shootout_decider_only_check"
    CHECK (
        "homeShootoutScore" IS NULL
        OR "stage" = 'TITLE_DECIDER'::"FixtureStage"
    );

-- 3. NEVER LEVEL.
-- The entire reason a shootout exists is that it cannot end drawn. A stored
-- 4-4 would mean the championship was never actually decided, while looking
-- like a settled result - the single most dangerous state this feature
-- could reach.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_shootout_not_drawn_check"
    CHECK (
        "homeShootoutScore" IS NULL
        OR "homeShootoutScore" <> "awayShootoutScore"
    );

-- 4. NON-NEGATIVE.
-- Nobody scores minus one penalty.
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_shootout_non_negative_check"
    CHECK (
        "homeShootoutScore" IS NULL
        OR ("homeShootoutScore" >= 0 AND "awayShootoutScore" >= 0)
    );
