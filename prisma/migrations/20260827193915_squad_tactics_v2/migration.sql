/*
  Warnings:

  - You are about to drop the column `x` on the `LineupSlot` table. All the data in the column will be lost.
  - You are about to drop the column `y` on the `LineupSlot` table. All the data in the column will be lost.
  - You are about to drop the column `tacticStyle` on the `Team` table. All the data in the column will be lost.
  - Added the required column `slotIndex` to the `LineupSlot` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LineupSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    CONSTRAINT "LineupSlot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LineupSlot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LineupSlot" ("id", "playerId", "teamId") SELECT "id", "playerId", "teamId" FROM "LineupSlot";
DROP TABLE "LineupSlot";
ALTER TABLE "new_LineupSlot" RENAME TO "LineupSlot";
CREATE UNIQUE INDEX "LineupSlot_playerId_key" ON "LineupSlot"("playerId");
CREATE TABLE "new_Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "fitness" INTEGER NOT NULL DEFAULT 100,
    "availability" TEXT NOT NULL DEFAULT 'available',
    "jerseyNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Player_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Player" ("age", "createdAt", "id", "jerseyNumber", "name", "position", "rating", "teamId") SELECT "age", "createdAt", "id", "jerseyNumber", "name", "position", "rating", "teamId" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE TABLE "new_Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "crestShape" TEXT,
    "crestPattern" TEXT,
    "crestIcon" TEXT,
    "crestColor" TEXT,
    "crestSecondaryColor" TEXT,
    "crestBorderColor" TEXT,
    "crestImageUrl" TEXT,
    "countryCode" TEXT,
    "stadiumName" TEXT,
    "stadiumStyle" TEXT,
    "stadiumCapacity" INTEGER NOT NULL DEFAULT 100,
    "crowdStyle" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "formation" TEXT,
    "mentality" TEXT,
    "tempo" TEXT,
    "pressing" TEXT,
    "width" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "captainId" TEXT,
    "penaltyTakerId" TEXT,
    "freeKickTakerId" TEXT,
    "cornerTakerId" TEXT,
    CONSTRAINT "Team_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Team_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Team_penaltyTakerId_fkey" FOREIGN KEY ("penaltyTakerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Team_freeKickTakerId_fkey" FOREIGN KEY ("freeKickTakerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Team_cornerTakerId_fkey" FOREIGN KEY ("cornerTakerId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Team" ("countryCode", "createdAt", "crestBorderColor", "crestColor", "crestIcon", "crestImageUrl", "crestPattern", "crestSecondaryColor", "crestShape", "crowdStyle", "formation", "id", "isBot", "name", "stadiumCapacity", "stadiumName", "stadiumStyle", "userId") SELECT "countryCode", "createdAt", "crestBorderColor", "crestColor", "crestIcon", "crestImageUrl", "crestPattern", "crestSecondaryColor", "crestShape", "crowdStyle", "formation", "id", "isBot", "name", "stadiumCapacity", "stadiumName", "stadiumStyle", "userId" FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
CREATE UNIQUE INDEX "Team_userId_key" ON "Team"("userId");
CREATE UNIQUE INDEX "Team_captainId_key" ON "Team"("captainId");
CREATE UNIQUE INDEX "Team_penaltyTakerId_key" ON "Team"("penaltyTakerId");
CREATE UNIQUE INDEX "Team_freeKickTakerId_key" ON "Team"("freeKickTakerId");
CREATE UNIQUE INDEX "Team_cornerTakerId_key" ON "Team"("cornerTakerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
