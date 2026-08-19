-- CreateEnum
CREATE TYPE "AssignmentWorkType" AS ENUM ('WORK');

-- CreateEnum
CREATE TYPE "TechnicianAssignmentStatus" AS ENUM ('ASSIGNED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "TechnicianAssignment" (
    "id" TEXT NOT NULL,
    "technicianProfileId" TEXT NOT NULL,
    "workType" "AssignmentWorkType" NOT NULL DEFAULT 'WORK',
    "workReferenceId" TEXT NOT NULL,
    "status" "TechnicianAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianAssignment_technicianProfileId_idx" ON "TechnicianAssignment"("technicianProfileId");

-- CreateIndex
CREATE INDEX "TechnicianAssignment_workReferenceId_idx" ON "TechnicianAssignment"("workReferenceId");

-- CreateIndex
CREATE INDEX "TechnicianAssignment_workType_idx" ON "TechnicianAssignment"("workType");

-- CreateIndex
CREATE INDEX "TechnicianAssignment_status_idx" ON "TechnicianAssignment"("status");

-- CreateIndex
CREATE INDEX "TechnicianAssignment_startsAt_idx" ON "TechnicianAssignment"("startsAt");

-- CreateIndex
CREATE INDEX "TechnicianAssignment_endsAt_idx" ON "TechnicianAssignment"("endsAt");

-- AddForeignKey
ALTER TABLE "TechnicianAssignment" ADD CONSTRAINT "TechnicianAssignment_technicianProfileId_fkey" FOREIGN KEY ("technicianProfileId") REFERENCES "TechnicianProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
