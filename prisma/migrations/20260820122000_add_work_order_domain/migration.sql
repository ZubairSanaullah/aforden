-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workOrderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "workTypeId" TEXT NOT NULL,
    "assignedTechnicianId" TEXT,
    "workTypeName" TEXT NOT NULL,
    "workTypeCode" TEXT,
    "estimatedDuration" INTEGER,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "internalNotes" TEXT,
    "holdReason" TEXT,
    "cancellationReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_workspaceId_workOrderNumber_key" ON "WorkOrder"("workspaceId", "workOrderNumber");

-- CreateIndex
CREATE INDEX "WorkOrder_workspaceId_idx" ON "WorkOrder"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkOrder_customerId_idx" ON "WorkOrder"("customerId");

-- CreateIndex
CREATE INDEX "WorkOrder_locationId_idx" ON "WorkOrder"("locationId");

-- CreateIndex
CREATE INDEX "WorkOrder_workTypeId_idx" ON "WorkOrder"("workTypeId");

-- CreateIndex
CREATE INDEX "WorkOrder_assignedTechnicianId_idx" ON "WorkOrder"("assignedTechnicianId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_priority_idx" ON "WorkOrder"("priority");

-- CreateIndex
CREATE INDEX "WorkOrder_workspaceId_status_idx" ON "WorkOrder"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_createdAt_idx" ON "WorkOrder"("createdAt");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "WorkType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assignedTechnicianId_fkey" FOREIGN KEY ("assignedTechnicianId") REFERENCES "TechnicianProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
