-- CHAMPIONSHIP PLAYOFF - HISTORICAL DRAW IMMUTABILITY.
--
-- A championship draw is a permanent sporting fact. Once a division's draw
-- seed exists, and once the bracket it produced has been written down, those
-- two values are the record of how the title was contested - and a record
-- that can be rewritten is not a record.
--
-- The application already refuses to overwrite either field: there are
-- exactly two writes to this table in the whole codebase, and the one that
-- persists the bracket is guarded by `if (!stored)`. That protects against
-- code. It does not protect against a psql session, a Neon console, or a
-- maintenance script written in two years by someone who has never read
-- playoffs.ts. This migration moves the guarantee to where nothing can route
-- around it.
--
-- WHY A TRIGGER, WHICH IS NORMALLY THE WRONG ANSWER. PostgreSQL has no
-- declarative write-once column: a CHECK constraint cannot see OLD, and
-- REVOKE UPDATE(column) would also block the one legitimate write - the
-- NULL -> bracket transition the draw itself makes. A BEFORE UPDATE row
-- trigger is the minimum mechanism that expresses "this may be written once".
-- It touches one table that will hold single-digit rows, writes nothing,
-- cascades to nothing, and is invisible to Prisma.
--
-- WHAT IT DELIBERATELY DOES NOT DO: it never inspects any column but these
-- two. An UPDATE that leaves both untouched passes through, so any field
-- added to ChampionshipPlayoff later is unaffected by this rule.

CREATE OR REPLACE FUNCTION "championship_playoff_draw_write_once"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- THE SEED IS FIXED AT CREATION. It is derived from the division's own
    -- completed league record - the record that produced the tie - and every
    -- audit of the bracket recomputes from it. A changed seed would make an
    -- honest bracket look forged, and a forged one look honest.
    IF NEW."drawSeed" IS DISTINCT FROM OLD."drawSeed" THEN
        RAISE EXCEPTION
            'ChampionshipPlayoff.drawSeed is immutable: the draw seed of playoff % is a permanent sporting fact and cannot be changed after creation', OLD."id"
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    -- THE BRACKET IS WRITE-ONCE. NULL means the knockout has not been
    -- entered, so NULL -> bracket is the draw happening and is allowed. Every
    -- other transition is rewriting a draw that has already been made:
    -- bracket -> different bracket moves clubs that have already played, and
    -- bracket -> NULL erases the record entirely.
    IF OLD."knockoutDraw" IS NOT NULL
       AND NEW."knockoutDraw" IS DISTINCT FROM OLD."knockoutDraw" THEN
        RAISE EXCEPTION
            'ChampionshipPlayoff.knockoutDraw is write-once: the knockout bracket of playoff % has already been drawn and cannot be rewritten or cleared', OLD."id"
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "ChampionshipPlayoff_draw_write_once" ON "ChampionshipPlayoff";

CREATE TRIGGER "ChampionshipPlayoff_draw_write_once"
    BEFORE UPDATE ON "ChampionshipPlayoff"
    FOR EACH ROW
    EXECUTE FUNCTION "championship_playoff_draw_write_once"();
