-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "city" TEXT,
    "stadiumName" TEXT,
    "stadiumStyle" TEXT,
    "stadiumCapacity" INTEGER NOT NULL DEFAULT 100,
    "crowdStyle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Team_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Team" ("countryCode", "createdAt", "crestBorderColor", "crestColor", "crestIcon", "crestImageUrl", "crestPattern", "crestSecondaryColor", "crestShape", "crowdStyle", "id", "name", "stadiumName", "userId") SELECT "countryCode", "createdAt", "crestBorderColor", "crestColor", "crestIcon", "crestImageUrl", "crestPattern", "crestSecondaryColor", "crestShape", "crowdStyle", "id", "name", "stadiumName", "userId" FROM "Team";
DROP TABLE "Team";
ALTER TABLE "new_Team" RENAME TO "Team";
CREATE UNIQUE INDEX "Team_userId_key" ON "Team"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
