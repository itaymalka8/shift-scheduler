/*
  Warnings:

  - You are about to drop the column `availability` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `jerseyNumber` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `position` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `rating` on the `Player` table. All the data in the column will be lost.
  - Added the required column `firstName` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastName` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `marketValue` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nationality` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `overall` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `potential` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `preferredFoot` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `primaryPosition` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `shirtNumber` to the `Player` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Player" DROP COLUMN "availability",
DROP COLUMN "jerseyNumber",
DROP COLUMN "name",
DROP COLUMN "position",
DROP COLUMN "rating",
ADD COLUMN     "firstName" TEXT NOT NULL,
ADD COLUMN     "injuryStatus" TEXT,
ADD COLUMN     "lastName" TEXT NOT NULL,
ADD COLUMN     "marketValue" INTEGER NOT NULL,
ADD COLUMN     "nationality" TEXT NOT NULL,
ADD COLUMN     "overall" INTEGER NOT NULL,
ADD COLUMN     "potential" INTEGER NOT NULL,
ADD COLUMN     "preferredFoot" TEXT NOT NULL,
ADD COLUMN     "primaryPosition" TEXT NOT NULL,
ADD COLUMN     "secondaryPositions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "shirtNumber" INTEGER NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'available',
ADD COLUMN     "suspensionMatches" INTEGER NOT NULL DEFAULT 0;
