/*
  Warnings:

  - You are about to drop the column `crestPreset` on the `Team` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "crestShape" TEXT,
    "crestIcon" TEXT,
    "crestColor" TEXT,
    "crestImageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Team_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Team" ("createdAt", "crestImageUrl", "id", "name", "userId") SELECT "createdAt", "crestImageUrl", "id", "name", "userId" FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
CREATE UNIQUE INDEX "Team_userId_key" ON "Team"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
