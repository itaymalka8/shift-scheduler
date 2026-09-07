-- CreateEnum
CREATE TYPE "KitType" AS ENUM ('HOME', 'AWAY', 'THIRD');

-- CreateTable
CREATE TABLE "TeamKit" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "type" "KitType" NOT NULL,
    "template" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL,
    "secondaryColor" TEXT NOT NULL,
    "accentColor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamKit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamKit_teamId_type_key" ON "TeamKit"("teamId", "type");

-- AddForeignKey
ALTER TABLE "TeamKit" ADD CONSTRAINT "TeamKit_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
