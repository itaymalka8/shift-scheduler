-- PLAYED SPORTING HISTORY IS APPEND ONLY.
--
-- Once a fixture has kicked off it is a permanent record of something that
-- happened in the football world: a score, its events, its player ratings,
-- the money it took at the gate. Until now the only thing standing between
-- that record and oblivion was that nobody had written the DELETE. There is
-- no Team, Season, Division, Player or User deletion anywhere in the
-- codebase - and absence of a path is not a constraint. A psql session, a
-- Neon console, or an admin tool written in two years by someone who has
-- never read this file would find nothing in its way.
--
-- Worse, the protection that DID exist was accidental. A Season could only
-- survive because SeasonChampion and ChampionshipPlayoff RESTRICT it - so a
-- season that had crowned nobody was fully deletable, taking every fixture,
-- event and player record with it. Retention must not depend on whether a
-- season happened to produce a champion.
--
-- WHAT "PLAYED" MEANS HERE, and why it is not the anti-spoiler rule.
-- The application decides whether a viewer may SEE a result with
-- isMatchFinished(scheduledAt, now) - ten real minutes after kickoff. That
-- is the right rule for spoilers and the wrong one here, for two reasons:
--
--   1. playedAt is written BY THE ENGINE AT KICKOFF, so it becomes true
--      EARLIER. For protection, earlier is safer - the row is guarded from
--      the moment the match exists, not ten minutes later.
--   2. `playedAt IS NOT NULL` IS CLOCK-FREE. A database rule that has to ask
--      what time it is cannot be deterministic. This one never asks.
--
-- And nothing is lost by it: a fixture with playedAt NULL has no score, no
-- MatchEvent and no PlayerMatchStats. Deleting it destroys no sporting fact,
-- which is exactly why schedule regeneration must keep working.

-- ---------------------------------------------------------------------------
-- PART 1 - SIX FOREIGN KEYS: CASCADE -> RESTRICT
--
-- Only the ON DELETE action changes. The referencing columns and the targets
-- are identical, so PostgreSQL re-creates the constraint's trigger pair
-- without re-validating a single existing row - no table rewrite, no scan, no
-- backfill. Every one of these is already satisfied by all current data.
--
-- ADD CONSTRAINT takes ACCESS EXCLUSIVE on both tables for its duration. At
-- this size that is milliseconds, and prod:deploy:safe suspends Cron across
-- the whole window regardless.
-- ---------------------------------------------------------------------------

-- A fixture belongs to its division for good. This one constraint closes BOTH
-- the Season and the Division erasure paths: Season -> Division is still
-- CASCADE, but the Division can no longer go while any fixture points at it,
-- so the cascade stops one step short of the football. Deleting a never-played
-- division is still possible - remove its (unplayed) fixtures first, exactly
-- as next-season.ts already does when it rebuilds a schedule.
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_divisionId_fkey";
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A club that has played cannot be erased by deleting the club. Both sides,
-- because a match has two of them and either would take the row with it.
--
-- Team deletion was ALREADY blocked in practice, by TeamEra.teamId RESTRICT -
-- but only because every club happens to have an era. That is a convention
-- held up by two creation paths, not a rule. These make it structural.
ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_homeTeamId_fkey";
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_homeTeamId_fkey"
    FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Fixture" DROP CONSTRAINT "Fixture_awayTeamId_fkey";
ALTER TABLE "Fixture" ADD CONSTRAINT "Fixture_awayTeamId_fkey"
    FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A goal is scored BY a club. Deleting the club must not delete the goal.
ALTER TABLE "MatchEvent" DROP CONSTRAINT "MatchEvent_teamId_fkey";
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- APPEARANCES, GOALS AND RATINGS SURVIVE THE PLAYER. This is the constraint a
-- Player Hall of Fame rests on: a career page is a public claim, and it cannot
-- be underwritten by "nothing deletes players yet". Retirement, release and
-- transfer all keep the row (careerStatus, teamId), so none of them are
-- affected - this only stops a Player row from being destroyed outright once
-- they have taken the field.
ALTER TABLE "PlayerMatchStats" DROP CONSTRAINT "PlayerMatchStats_playerId_fkey";
ALTER TABLE "PlayerMatchStats" ADD CONSTRAINT "PlayerMatchStats_playerId_fkey"
    FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money that actually moved is an audit trail, not current state.
ALTER TABLE "FinancialTransaction" DROP CONSTRAINT "FinancialTransaction_teamId_fkey";
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DELIBERATELY UNCHANGED: MatchEvent.fixtureId and PlayerMatchStats.fixtureId
-- stay CASCADE. Once PART 2 makes a played fixture undeletable, the only
-- fixture that can still be deleted is an unplayed one - which by definition
-- has no events and no stats. RESTRICT there would buy nothing and would make
-- honest schedule cleanup harder.

-- ---------------------------------------------------------------------------
-- PART 2 - A PLAYED FIXTURE CANNOT BE DELETED
--
-- WHY A TRIGGER, WHICH IS NORMALLY THE WRONG ANSWER. The other six rules are
-- about a row's PARENT, and a foreign key says those cleanly. This one is
-- about the row's OWN column, and no foreign key can express it. A CHECK
-- constraint cannot either - a CHECK is not evaluated on DELETE at all. A
-- BEFORE DELETE row trigger is the minimum mechanism that says "this row has
-- entered history".
--
-- It reads one column, writes nothing, cascades to nothing, and is invisible
-- to Prisma. An unplayed fixture passes straight through it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "fixture_played_no_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- playedAt IS NOT NULL means the engine has run this match: there is a
    -- score, and there are events and player records hanging off it. The row
    -- is the record of something that happened.
    IF OLD."playedAt" IS NOT NULL THEN
        RAISE EXCEPTION
            'Fixture % has been played (playedAt %) and cannot be deleted: played sporting history is append only', OLD."id", OLD."playedAt"
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    -- Never played: no score, no events, no player stats. A future schedule
    -- is not history, and regenerating one is a legitimate operation.
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS "Fixture_played_no_delete" ON "Fixture";

CREATE TRIGGER "Fixture_played_no_delete"
    BEFORE DELETE ON "Fixture"
    FOR EACH ROW
    EXECUTE FUNCTION "fixture_played_no_delete"();
