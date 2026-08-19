-- AlterTable
ALTER TABLE "TechnicianAssignment" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TechnicianAssignment_completedAt_idx" ON "TechnicianAssignment"("completedAt");

-- CreateIndex
CREATE INDEX "TechnicianAssignment_cancelledAt_idx" ON "TechnicianAssignment"("cancelledAt");
