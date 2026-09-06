-- THE ECONOMY'S MEMORY: PER-CLUB ECONOMIC STATE, APPEND ONLY.
--
-- WHAT THIS FIXES. Sponsor income settles at a weekly boundary and attendance
-- at a fixture's own kickoff, but both read the LIVE Player table at whatever
-- moment the job actually ran. A delayed settlement - a Cron outage, a
-- transaction that rolled back and retried - therefore priced a past instant
-- using rosters that had since moved. Nothing in the schema could reconstruct
-- Player.overall, weeklySalary, teamId or careerStatus as they stood at a past
-- instant, so "what was this league worth at T" had no answer at all once
-- anybody transferred, released, retired or was promoted.
--
-- WHY HISTORY AND NOT A PER-WEEK SNAPSHOT. A snapshot must be written AT the
-- instant it describes, which is exactly what an outage prevents: a job that
-- finally runs at T+30 can only observe post-mutation state, and storing that
-- under T would manufacture a durable record of something that was never true -
-- strictly worse than today, because it would carry a claim of authority.
-- Append-only history needs no foreknowledge of T: it records CHANGES, and
-- every instant lies between two changes.
--
-- THE TABLE IS ONLY EXACT FROM ITS BASELINE FORWARD. It cannot answer for
-- instants before its first row, because that information was never recorded.
-- The baseline is written by prod:economy:baseline AFTER both Render services
-- are confirmed on the appender commit, and strictly before the Phase 3R
-- activation boundary - never here. A migration-time INSERT would be raced:
-- `prisma migrate deploy` runs inside render.yaml's buildCommand while the OLD
-- web instance is still serving registrations, promotions, purchases and
-- releases with no appender in it.

CREATE TABLE "TeamEconomicState" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "weeklyPayroll" INTEGER NOT NULL,
    "attendanceQuality" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEconomicState_pkey" PRIMARY KEY ("id")
);

-- THE PER-CLUB TOTAL ORDER, enforced by the database rather than by a caller
-- remembering to hold a lock. clock_timestamp() is evaluated once per
-- STATEMENT, so any batched append - a development pass, a repricing group, a
-- multi-prospect promotion - produces identical timestamps by construction;
-- `version` is what orders them. Allocated as MAX(version)+1 under the club's
-- own lockTeamRoster write-lock, so a forgotten lock surfaces here as a
-- unique violation on the transaction that caused it, not as a silent
-- duplicate discovered a season later.
CREATE UNIQUE INDEX "TeamEconomicState_teamId_version_key"
    ON "TeamEconomicState"("teamId", "version");

-- THE AS-OF QUERY PATH: seek to (teamId, T), walk backwards, take the first
-- row. Both sort columns are in the index, so the tie-break needs no heap
-- fetch and no sort.
CREATE INDEX "TeamEconomicState_teamId_effectiveAt_version_idx"
    ON "TeamEconomicState"("teamId", "effectiveAt" DESC, "version" DESC);

-- RESTRICT, matching TeamEra and SquadReplenishment. This also closes a
-- transitive path: Team.userId is ON DELETE CASCADE from User, so deleting a
-- User would otherwise delete the Team and take its economic history with it.
-- That whole chain now aborts, exactly as it already does for a club with a
-- human era.
ALTER TABLE "TeamEconomicState"
    ADD CONSTRAINT "TeamEconomicState_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- APPEND ONLY, ENFORCED BY THE DATABASE - UPDATE, DELETE **AND** TRUNCATE.
--
-- Stricter than Fixture_played_no_delete on purpose, in two ways.
--
--   1. BOTH VERBS, UNCONDITIONALLY. A fixture has an unplayed state in which
--      deletion destroys no sporting fact, so that trigger is conditional.
--      There is no such state here: a row describes an instant that has
--      already happened, so every UPDATE and every DELETE is a rewrite of
--      history. Corrections are new rows - that is what `version` is for.
--
--   2. TRUNCATE TOO. Row-level BEFORE DELETE triggers do NOT fire on TRUNCATE;
--      only a statement-level BEFORE TRUNCATE trigger does. Leaving that hole
--      open because the proof harness happens to use TRUNCATE would be
--      weakening production integrity for test convenience, so the harness
--      drops and recreates its schema instead (scripts/proof/reset.ts) and the
--      hole is closed here.
--
-- No production path may disable these. There is no application code that
-- updates, deletes or truncates this table, and now there is no way to add one
-- by accident.
CREATE OR REPLACE FUNCTION "team_economic_state_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION
            'TeamEconomicState is append only: TRUNCATE refused; economic history cannot be discarded'
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;

    RAISE EXCEPTION
        'TeamEconomicState is append only: % on team % (version %) refused; corrections are new rows',
        TG_OP, OLD."teamId", OLD."version"
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "TeamEconomicState_no_update"
    BEFORE UPDATE ON "TeamEconomicState"
    FOR EACH ROW
    EXECUTE FUNCTION "team_economic_state_append_only"();

CREATE TRIGGER "TeamEconomicState_no_delete"
    BEFORE DELETE ON "TeamEconomicState"
    FOR EACH ROW
    EXECUTE FUNCTION "team_economic_state_append_only"();

CREATE TRIGGER "TeamEconomicState_no_truncate"
    BEFORE TRUNCATE ON "TeamEconomicState"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "team_economic_state_append_only"();
