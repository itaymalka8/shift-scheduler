-- Performance foundation for the Match Calendar / Match History phase.
-- CREATE INDEX only: this migration adds no column, drops nothing, and
-- touches no row of data. Every statement below is exactly what
-- `prisma migrate diff` generates for the @@index entries added to
-- prisma/schema.prisma in the same commit.

-- CreateIndex
CREATE INDEX "DivisionTeam_teamId_idx" ON "DivisionTeam"("teamId");

-- CreateIndex
CREATE INDEX "Fixture_homeTeamId_scheduledAt_idx" ON "Fixture"("homeTeamId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Fixture_awayTeamId_scheduledAt_idx" ON "Fixture"("awayTeamId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Fixture_divisionId_matchday_idx" ON "Fixture"("divisionId", "matchday");

-- CreateIndex
CREATE INDEX "Fixture_playedAt_scheduledAt_idx" ON "Fixture"("playedAt", "scheduledAt");

-- CreateIndex
CREATE INDEX "MatchEvent_fixtureId_minute_idx" ON "MatchEvent"("fixtureId", "minute");
