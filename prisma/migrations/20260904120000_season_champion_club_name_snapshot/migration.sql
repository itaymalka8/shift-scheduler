-- THE CLUB'S NAME AT THE INSTANT A TITLE WAS DECIDED.
--
-- Team.name is mutable, and the takeover flow rewrites it: a signup that
-- claims a bot club renames it to whatever the new manager typed. So a title
-- won by a bot club in season 1 would, without this, be displayed under a
-- name a different person chose in season 4 - not a rebrand, a false
-- statement about who won it.
--
-- This is a DISPLAY SNAPSHOT. The champion's identity is and remains
-- "teamId". Nothing joins on this column, groups by it, or finds a club with
-- it.
--
-- Nullable, and only because a row written before this column existed could
-- not have one and no name could honestly be invented for it afterwards.
-- Production holds zero SeasonChampion rows, so there is nothing to backfill
-- and every title the game ever awards will carry its name from birth.
-- IF NOT EXISTS so the whole file is re-runnable by hand, matching the
-- CREATE OR REPLACE / DROP IF EXISTS below. Prisma never re-applies a
-- recorded migration, so this changes nothing about normal deployment - it
-- means the two halves of this file behave the same way if anyone ever runs
-- it directly.
ALTER TABLE "SeasonChampion" ADD COLUMN IF NOT EXISTS "clubNameAtDecision" TEXT;

-- ---------------------------------------------------------------------
-- WRITE-ONCE, at the database.
--
-- Same discipline as ChampionshipPlayoff's draw immutability, and for the
-- same reason: a historical record that can be quietly edited is not a
-- record. The application writes this once, inside the transaction that
-- creates the row; nothing in the codebase ever updates it. This makes that
-- true for a psql session, a Neon console and a maintenance script too.
--
-- The rule is deliberately ABSOLUTE - stricter than the playoff draw's
-- null-to-value allowance. There is no legitimate later write: the name is
-- known at INSERT and is never knowable afterwards. Permitting NULL -> value
-- would open the exact door the snapshot exists to close, letting someone
-- decide in season 40 what a club "was called" in season 1. A row that
-- somehow lacks a name stays honest about not having one.
--
-- Like the playoff trigger, it inspects ONE column, so any field added to
-- SeasonChampion later is unaffected and stays freely updatable.
CREATE OR REPLACE FUNCTION "season_champion_club_name_write_once"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."clubNameAtDecision" IS DISTINCT FROM OLD."clubNameAtDecision" THEN
        RAISE EXCEPTION
            'SeasonChampion.clubNameAtDecision is write-once: the club name recorded for championship % is a historical display snapshot and cannot be changed after the title was decided', OLD."id"
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "SeasonChampion_club_name_write_once" ON "SeasonChampion";

CREATE TRIGGER "SeasonChampion_club_name_write_once"
    BEFORE UPDATE ON "SeasonChampion"
    FOR EACH ROW
    EXECUTE FUNCTION "season_champion_club_name_write_once"();
