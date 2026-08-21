-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ScheduleStatus" AS ENUM ('SCHEDULED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "DispatchStatus" AS ENUM ('PENDING_DISPATCH', 'DISPATCHED', 'ACKNOWLEDGED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ScheduleHistoryEventType" AS ENUM ('CREATED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'DISPATCHED', 'UNDISPATCHED', 'UPDATED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable ScheduleAppointment
CREATE TABLE "ScheduleAppointment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appointmentNumber" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "dispatchStatus" "DispatchStatus" NOT NULL DEFAULT 'PENDING_DISPATCH',
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedByMemberId" TEXT,
    "undispatchedAt" TIMESTAMP(3),
    "undispatchedByMemberId" TEXT,
    "fieldExecutionStartedAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable ScheduleAppointmentHistory
CREATE TABLE "ScheduleAppointmentHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "eventType" "ScheduleHistoryEventType" NOT NULL,
    "actorMemberId" TEXT,
    "actorName" TEXT,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleAppointmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for ScheduleAppointment
CREATE UNIQUE INDEX "ScheduleAppointment_workspaceId_appointmentNumber_key" ON "ScheduleAppointment"("workspaceId", "appointmentNumber");
CREATE INDEX "ScheduleAppointment_workspaceId_idx" ON "ScheduleAppointment"("workspaceId");
CREATE INDEX "ScheduleAppointment_workOrderId_idx" ON "ScheduleAppointment"("workOrderId");
CREATE INDEX "ScheduleAppointment_technicianId_idx" ON "ScheduleAppointment"("technicianId");
CREATE INDEX "ScheduleAppointment_workspaceId_technicianId_scheduledStart_scheduledEnd_idx" ON "ScheduleAppointment"("workspaceId", "technicianId", "scheduledStart", "scheduledEnd");
CREATE INDEX "ScheduleAppointment_workspaceId_workOrderId_idx" ON "ScheduleAppointment"("workspaceId", "workOrderId");
CREATE INDEX "ScheduleAppointment_workspaceId_scheduledStart_scheduledEnd_idx" ON "ScheduleAppointment"("workspaceId", "scheduledStart", "scheduledEnd");
CREATE INDEX "ScheduleAppointment_workspaceId_status_idx" ON "ScheduleAppointment"("workspaceId", "status");
CREATE INDEX "ScheduleAppointment_workspaceId_dispatchStatus_idx" ON "ScheduleAppointment"("workspaceId", "dispatchStatus");
CREATE INDEX "ScheduleAppointment_scheduledStart_idx" ON "ScheduleAppointment"("scheduledStart");
CREATE INDEX "ScheduleAppointment_scheduledEnd_idx" ON "ScheduleAppointment"("scheduledEnd");

-- CreateIndex for ScheduleAppointmentHistory
CREATE INDEX "ScheduleAppointmentHistory_workspaceId_idx" ON "ScheduleAppointmentHistory"("workspaceId");
CREATE INDEX "ScheduleAppointmentHistory_appointmentId_idx" ON "ScheduleAppointmentHistory"("appointmentId");
CREATE INDEX "ScheduleAppointmentHistory_workspaceId_appointmentId_createdAt_idx" ON "ScheduleAppointmentHistory"("workspaceId", "appointmentId", "createdAt");
CREATE INDEX "ScheduleAppointmentHistory_eventType_idx" ON "ScheduleAppointmentHistory"("eventType");

-- AddForeignKey for ScheduleAppointment
ALTER TABLE "ScheduleAppointment" ADD CONSTRAINT "ScheduleAppointment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleAppointment" ADD CONSTRAINT "ScheduleAppointment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleAppointment" ADD CONSTRAINT "ScheduleAppointment_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "TechnicianProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ScheduleAppointment" ADD CONSTRAINT "ScheduleAppointment_dispatchedByMemberId_fkey" FOREIGN KEY ("dispatchedByMemberId") REFERENCES "WorkspaceMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleAppointment" ADD CONSTRAINT "ScheduleAppointment_undispatchedByMemberId_fkey" FOREIGN KEY ("undispatchedByMemberId") REFERENCES "WorkspaceMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey for ScheduleAppointmentHistory
ALTER TABLE "ScheduleAppointmentHistory" ADD CONSTRAINT "ScheduleAppointmentHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleAppointmentHistory" ADD CONSTRAINT "ScheduleAppointmentHistory_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "ScheduleAppointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleAppointmentHistory" ADD CONSTRAINT "ScheduleAppointmentHistory_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "WorkspaceMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
