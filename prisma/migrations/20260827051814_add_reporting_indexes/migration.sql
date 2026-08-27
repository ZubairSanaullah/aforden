-- CreateIndex
CREATE INDEX "Invoice_workspaceId_status_issueDate_idx" ON "Invoice"("workspaceId", "status", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_createdAt_idx" ON "Invoice"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_workspaceId_status_paymentDate_idx" ON "Payment"("workspaceId", "status", "paymentDate");

-- CreateIndex
CREATE INDEX "Quote_workspaceId_createdAt_idx" ON "Quote"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Quote_workspaceId_status_approvedAt_idx" ON "Quote"("workspaceId", "status", "approvedAt");

-- CreateIndex
CREATE INDEX "ScheduleAppointmentHistory_workspaceId_eventType_createdAt_idx" ON "ScheduleAppointmentHistory"("workspaceId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "TechnicianTimeEntry_workspaceId_technicianProfileId_started_idx" ON "TechnicianTimeEntry"("workspaceId", "technicianProfileId", "startedAt");

-- CreateIndex
CREATE INDEX "TechnicianTimeEntry_workspaceId_entryType_startedAt_idx" ON "TechnicianTimeEntry"("workspaceId", "entryType", "startedAt");

-- CreateIndex
CREATE INDEX "WorkOrder_workspaceId_status_completedAt_idx" ON "WorkOrder"("workspaceId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "WorkOrder_workspaceId_createdAt_idx" ON "WorkOrder"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_workspaceId_status_cancelledAt_idx" ON "WorkOrder"("workspaceId", "status", "cancelledAt");

-- CreateIndex
CREATE INDEX "WorkOrder_workspaceId_assignedTechnicianId_status_idx" ON "WorkOrder"("workspaceId", "assignedTechnicianId", "status");

-- CreateIndex
CREATE INDEX "WorkOrderPart_workspaceId_consumedAt_idx" ON "WorkOrderPart"("workspaceId", "consumedAt");
