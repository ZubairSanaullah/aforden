-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "TimeEntryType" AS ENUM ('TRAVEL', 'ON_SITE', 'BREAK', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "TimeEntryStatus" AS ENUM ('ACTIVE', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE "TechnicianTimeEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "technicianProfileId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "entryType" "TimeEntryType" NOT NULL DEFAULT 'ON_SITE',
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "notes" TEXT,
    "metadata" JSONB,
    "createdByMemberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianTimeEntry_workspaceId_idx" ON "TechnicianTimeEntry"("workspaceId");
CREATE INDEX "TechnicianTimeEntry_technicianProfileId_idx" ON "TechnicianTimeEntry"("technicianProfileId");
CREATE INDEX "TechnicianTimeEntry_workOrderId_idx" ON "TechnicianTimeEntry"("workOrderId");
CREATE INDEX "TechnicianTimeEntry_workspaceId_technicianProfileId_status_idx" ON "TechnicianTimeEntry"("workspaceId", "technicianProfileId", "status");
CREATE INDEX "TechnicianTimeEntry_workspaceId_workOrderId_idx" ON "TechnicianTimeEntry"("workspaceId", "workOrderId");
CREATE INDEX "TechnicianTimeEntry_startedAt_idx" ON "TechnicianTimeEntry"("startedAt");

-- AddForeignKey
ALTER TABLE "TechnicianTimeEntry" ADD CONSTRAINT "TechnicianTimeEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TechnicianTimeEntry" ADD CONSTRAINT "TechnicianTimeEntry_technicianProfileId_fkey" FOREIGN KEY ("technicianProfileId") REFERENCES "TechnicianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TechnicianTimeEntry" ADD CONSTRAINT "TechnicianTimeEntry_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TechnicianTimeEntry" ADD CONSTRAINT "TechnicianTimeEntry_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "ScheduleAppointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TechnicianTimeEntry" ADD CONSTRAINT "TechnicianTimeEntry_createdByMemberId_fkey" FOREIGN KEY ("createdByMemberId") REFERENCES "WorkspaceMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
