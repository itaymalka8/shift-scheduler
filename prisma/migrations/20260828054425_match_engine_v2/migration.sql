-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN     "awayStats" JSONB,
ADD COLUMN     "homeStats" JSONB,
ADD COLUMN     "matchSeed" TEXT;

-- AlterTable
ALTER TABLE "MatchEvent" ADD COLUMN     "context" JSONB,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "playerId" TEXT,
ADD COLUMN     "secondaryPlayerId" TEXT;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "creativity" INTEGER,
ADD COLUMN     "experience" INTEGER,
ADD COLUMN     "longPassing" INTEGER,
ADD COLUMN     "secondBallAwareness" INTEGER;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "attackDirection" TEXT,
ADD COLUMN     "attackingStyle" TEXT,
ADD COLUMN     "creativeFreedom" TEXT,
ADD COLUMN     "customFormation" JSONB,
ADD COLUMN     "defensiveLine" TEXT,
ADD COLUMN     "dribbleFrequency" TEXT,
ADD COLUMN     "fullbackOverlaps" TEXT,
ADD COLUMN     "offsideTrap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passingType" TEXT;

-- CreateTable
CREATE TABLE "PlayerMatchStats" (
    "id" TEXT NOT NULL,
    "fixtureId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "minutesPlayed" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER NOT NULL DEFAULT 0,
    "shotsOnTarget" INTEGER NOT NULL DEFAULT 0,
    "passesAttempted" INTEGER NOT NULL DEFAULT 0,
    "passesCompleted" INTEGER NOT NULL DEFAULT 0,
    "keyPasses" INTEGER NOT NULL DEFAULT 0,
    "dribblesAttempted" INTEGER NOT NULL DEFAULT 0,
    "dribblesCompleted" INTEGER NOT NULL DEFAULT 0,
    "tackles" INTEGER NOT NULL DEFAULT 0,
    "interceptions" INTEGER NOT NULL DEFAULT 0,
    "aerialDuelsWon" INTEGER NOT NULL DEFAULT 0,
    "fouls" INTEGER NOT NULL DEFAULT 0,
    "yellowCards" INTEGER NOT NULL DEFAULT 0,
    "redCards" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 6,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerMatchStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerMatchStats_fixtureId_playerId_key" ON "PlayerMatchStats"("fixtureId", "playerId");

-- AddForeignKey
ALTER TABLE "PlayerMatchStats" ADD CONSTRAINT "PlayerMatchStats_fixtureId_fkey" FOREIGN KEY ("fixtureId") REFERENCES "Fixture"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchStats" ADD CONSTRAINT "PlayerMatchStats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
