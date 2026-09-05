-- MATCH CONSEQUENCES + LEGAL XI INTEGRITY
--
-- Two additive columns and one index. Nothing is dropped, no existing value is
-- rewritten, and no historical table is touched: PlayerMatchStats, MatchEvent
-- and every career total stay exactly as they are.

-- The exactly-once ledger for a fixture's player consequences. NULL means
-- "not applied yet"; the activator selects on it, and the conditional UPDATE
-- that sets it is what makes a retried cron run a no-op.
ALTER TABLE "Fixture" ADD COLUMN     "consequencesAppliedAt" TIMESTAMP(3);

-- Club fixtures a player must still sit out, injured. Counted in matches
-- rather than days for the same reason suspensionMatches already is: a
-- postponed fixture must not heal anybody merely because time passed.
ALTER TABLE "Player" ADD COLUMN     "injuryMatchesRemaining" INTEGER NOT NULL DEFAULT 0;

-- The activator's exact predicate: consequencesAppliedAt IS NULL AND
-- scheduledAt <= cutoff. The NULL column leads because IS NULL is
-- equality-shaped and seeks straight to the shrinking outstanding set.
CREATE INDEX "Fixture_consequencesAppliedAt_scheduledAt_idx" ON "Fixture"("consequencesAppliedAt", "scheduledAt");

-- THE FEATURE STARTS NOW, NOT RETROACTIVELY.
--
-- Every fixture already played happened before match consequences existed, so
-- it produced none: nobody was rested, nobody was hurt, nobody was banned, and
-- no ban was served. Leaving these rows NULL would make the activator's very
-- first run treat them as a backlog - injuring players over matches that
-- finished days ago, applying sixty fixtures' worth of fitness churn in one
-- tick, and serving suspensions for games that were never actually missed.
--
-- Marking them applied states the truth about them instead. It rewrites no
-- history: it records that these matches had no player consequences, which is
-- exactly what was the case. playedAt is the only test used, because a fixture
-- with a result is a fixture that has already happened.
UPDATE "Fixture" SET "consequencesAppliedAt" = "playedAt" WHERE "playedAt" IS NOT NULL;
