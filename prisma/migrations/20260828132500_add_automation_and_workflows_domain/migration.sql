-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'TIMED_OUT', 'CANCELED');

-- CreateEnum
CREATE TYPE "AutomationExecutionStepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "AutomationErrorPolicy" AS ENUM ('HALT_ON_ERROR', 'CONTINUE_ON_ERROR');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('WORK_ORDER_CREATED', 'WORK_ORDER_STATUS_CHANGED', 'WORK_ORDER_ASSIGNED', 'WORK_ORDER_COMPLETED', 'QUOTE_APPROVED', 'QUOTE_EXPIRED', 'INVOICE_ISSUED', 'INVOICE_PAYMENT_RECORDED', 'INVOICE_OVERDUE', 'INVENTORY_LOW_STOCK_REACHED', 'ASSET_MAINTENANCE_DUE', 'SCHEDULED_CRON', 'SCHEDULED_INTERVAL', 'SCHEDULED_ENTITY_OFFSET');

-- CreateEnum
CREATE TYPE "ConditionOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'CONTAINS', 'NOT_CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'MATCHES_REGEX', 'IN', 'NOT_IN', 'IS_EMPTY', 'IS_NOT_EMPTY', 'IS_NULL', 'IS_NOT_NULL', 'IS_TRUE', 'IS_FALSE', 'BEFORE_DATE', 'AFTER_DATE', 'WITHIN_LAST_DAYS', 'WITHIN_NEXT_DAYS');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('WORK_ORDER_CREATE', 'WORK_ORDER_UPDATE_STATUS', 'WORK_ORDER_ASSIGN_TECHNICIAN', 'WORK_ORDER_ADD_NOTE', 'INVOICE_CREATE_FROM_WORK_ORDER', 'INVOICE_ISSUE', 'NOTIFICATION_SEND_EMAIL', 'NOTIFICATION_SEND_IN_APP', 'INVENTORY_RESERVE_PARTS', 'CUSTOMER_UPDATE_STATUS', 'ASSET_SCHEDULE_MAINTENANCE');

-- CreateEnum
CREATE TYPE "AutomationConditionLogicalOperator" AS ENUM ('AND', 'OR');

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "errorPolicy" "AutomationErrorPolicy" NOT NULL DEFAULT 'HALT_ON_ERROR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationTrigger" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "eventType" VARCHAR(128),
    "configJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationConditionGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT,
    "parentGroupId" TEXT,
    "logicalOperator" "AutomationConditionLogicalOperator" NOT NULL DEFAULT 'AND',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationConditionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationCondition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conditionGroupId" TEXT NOT NULL,
    "fieldPath" VARCHAR(255) NOT NULL,
    "operator" "ConditionOperator" NOT NULL,
    "targetValueJson" JSONB NOT NULL,
    "valueType" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationAction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "actionType" "AutomationActionType" NOT NULL,
    "paramsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT,
    "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "correlationId" VARCHAR(128) NOT NULL,
    "parentExecutionId" TEXT,
    "causalityChain" TEXT[],
    "executionDepth" INTEGER NOT NULL DEFAULT 0,
    "triggerPayloadJson" JSONB NOT NULL,
    "dedupeKey" VARCHAR(255),
    "reasonCode" VARCHAR(128),
    "errorJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationExecutionStep" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "actionType" "AutomationActionType" NOT NULL,
    "status" "AutomationExecutionStepStatus" NOT NULL DEFAULT 'PENDING',
    "inputJson" JSONB,
    "outputJson" JSONB,
    "errorJson" JSONB,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationExecutionStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationScheduleJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "scheduleKind" VARCHAR(64) NOT NULL,
    "cronExpression" VARCHAR(128),
    "intervalSeconds" INTEGER,
    "entityOffsetJson" JSONB,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationScheduleJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_isEnabled_idx" ON "AutomationRule"("workspaceId", "isEnabled");

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_createdAt_idx" ON "AutomationRule"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationTrigger_ruleId_key" ON "AutomationTrigger"("ruleId");

-- CreateIndex
CREATE INDEX "AutomationTrigger_workspaceId_triggerType_idx" ON "AutomationTrigger"("workspaceId", "triggerType");

-- CreateIndex
CREATE INDEX "AutomationTrigger_workspaceId_eventType_idx" ON "AutomationTrigger"("workspaceId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationConditionGroup_ruleId_key" ON "AutomationConditionGroup"("ruleId");

-- CreateIndex
CREATE INDEX "AutomationConditionGroup_workspaceId_idx" ON "AutomationConditionGroup"("workspaceId");

-- CreateIndex
CREATE INDEX "AutomationConditionGroup_parentGroupId_idx" ON "AutomationConditionGroup"("parentGroupId");

-- CreateIndex
CREATE INDEX "AutomationCondition_workspaceId_idx" ON "AutomationCondition"("workspaceId");

-- CreateIndex
CREATE INDEX "AutomationCondition_conditionGroupId_idx" ON "AutomationCondition"("conditionGroupId");

-- CreateIndex
CREATE INDEX "AutomationAction_workspaceId_idx" ON "AutomationAction"("workspaceId");

-- CreateIndex
CREATE INDEX "AutomationAction_ruleId_stepOrder_idx" ON "AutomationAction"("ruleId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationAction_ruleId_stepOrder_key" ON "AutomationAction"("ruleId", "stepOrder");

-- CreateIndex
CREATE INDEX "AutomationExecution_workspaceId_status_createdAt_idx" ON "AutomationExecution"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_workspaceId_ruleId_createdAt_idx" ON "AutomationExecution"("workspaceId", "ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_correlationId_idx" ON "AutomationExecution"("correlationId");

-- CreateIndex
CREATE INDEX "AutomationExecution_parentExecutionId_idx" ON "AutomationExecution"("parentExecutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationExecution_workspaceId_ruleId_dedupeKey_key" ON "AutomationExecution"("workspaceId", "ruleId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AutomationExecutionStep_workspaceId_status_idx" ON "AutomationExecutionStep"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "AutomationExecutionStep_executionId_stepOrder_idx" ON "AutomationExecutionStep"("executionId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationExecutionStep_executionId_stepOrder_key" ON "AutomationExecutionStep"("executionId", "stepOrder");

-- CreateIndex
CREATE INDEX "AutomationScheduleJob_workspaceId_isActive_nextRunAt_idx" ON "AutomationScheduleJob"("workspaceId", "isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "AutomationScheduleJob_ruleId_idx" ON "AutomationScheduleJob"("ruleId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrigger" ADD CONSTRAINT "AutomationTrigger_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrigger" ADD CONSTRAINT "AutomationTrigger_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationConditionGroup" ADD CONSTRAINT "AutomationConditionGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationConditionGroup" ADD CONSTRAINT "AutomationConditionGroup_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationConditionGroup" ADD CONSTRAINT "AutomationConditionGroup_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "AutomationConditionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationCondition" ADD CONSTRAINT "AutomationCondition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationCondition" ADD CONSTRAINT "AutomationCondition_conditionGroupId_fkey" FOREIGN KEY ("conditionGroupId") REFERENCES "AutomationConditionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecution" ADD CONSTRAINT "AutomationExecution_parentExecutionId_fkey" FOREIGN KEY ("parentExecutionId") REFERENCES "AutomationExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecutionStep" ADD CONSTRAINT "AutomationExecutionStep_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationExecutionStep" ADD CONSTRAINT "AutomationExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AutomationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationScheduleJob" ADD CONSTRAINT "AutomationScheduleJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationScheduleJob" ADD CONSTRAINT "AutomationScheduleJob_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
