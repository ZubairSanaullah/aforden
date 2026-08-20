-- CreateEnum for WorkOrderHistoryEventType
DO $$ BEGIN
    CREATE TYPE "WorkOrderHistoryEventType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'ASSIGNED', 'REASSIGNED', 'UNASSIGNED', 'DELETED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable WorkOrderHistory
CREATE TABLE IF NOT EXISTS "WorkOrderHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "eventType" "WorkOrderHistoryEventType" NOT NULL,
    "actorMemberId" TEXT,
    "actorName" TEXT,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for WorkOrderHistory
CREATE INDEX IF NOT EXISTS "WorkOrderHistory_workspaceId_idx" ON "WorkOrderHistory"("workspaceId");
CREATE INDEX IF NOT EXISTS "WorkOrderHistory_workOrderId_idx" ON "WorkOrderHistory"("workOrderId");
CREATE INDEX IF NOT EXISTS "WorkOrderHistory_workspaceId_workOrderId_idx" ON "WorkOrderHistory"("workspaceId", "workOrderId");
CREATE INDEX IF NOT EXISTS "WorkOrderHistory_eventType_idx" ON "WorkOrderHistory"("eventType");
CREATE INDEX IF NOT EXISTS "WorkOrderHistory_createdAt_idx" ON "WorkOrderHistory"("createdAt");
CREATE INDEX IF NOT EXISTS "WorkOrderHistory_workspaceId_workOrderId_createdAt_idx" ON "WorkOrderHistory"("workspaceId", "workOrderId", "createdAt");

-- AddForeignKey for WorkOrderHistory
DO $$ BEGIN
    ALTER TABLE "WorkOrderHistory" ADD CONSTRAINT "WorkOrderHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "WorkOrderHistory" ADD CONSTRAINT "WorkOrderHistory_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "WorkspaceMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
