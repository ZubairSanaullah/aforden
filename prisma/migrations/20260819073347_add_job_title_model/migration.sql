/*
  Warnings:

  - You are about to drop the column `jobTitle` on the `Employee` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "JobTitleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "Employee" DROP COLUMN "jobTitle",
ADD COLUMN     "jobTitleId" TEXT;

-- CreateTable
CREATE TABLE "JobTitle" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "JobTitleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobTitle_workspaceId_idx" ON "JobTitle"("workspaceId");

-- CreateIndex
CREATE INDEX "JobTitle_status_idx" ON "JobTitle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_workspaceId_name_key" ON "JobTitle"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Employee_jobTitleId_idx" ON "Employee"("jobTitleId");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_jobTitleId_fkey" FOREIGN KEY ("jobTitleId") REFERENCES "JobTitle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTitle" ADD CONSTRAINT "JobTitle_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
