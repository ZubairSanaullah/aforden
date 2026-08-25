-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('WORK_ORDER_CREATED', 'WORK_ORDER_ASSIGNED', 'WORK_ORDER_REASSIGNED', 'WORK_ORDER_UNASSIGNED', 'WORK_ORDER_STATUS_CHANGED', 'WORK_ORDER_STARTED', 'WORK_ORDER_PAUSED', 'WORK_ORDER_RESUMED', 'WORK_ORDER_COMPLETED', 'WORK_ORDER_CANCELLED', 'SCHEDULE_APPOINTMENT_SCHEDULED', 'SCHEDULE_APPOINTMENT_RESCHEDULED', 'SCHEDULE_DISPATCH_CHANGED', 'SCHEDULE_APPOINTMENT_APPROACHING', 'QUOTE_CREATED', 'QUOTE_SENT', 'QUOTE_ACCEPTED', 'QUOTE_REJECTED', 'QUOTE_EXPIRED', 'INVOICE_CREATED', 'INVOICE_SENT', 'INVOICE_OVERDUE', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'PARTIALLY_SENT', 'FAILED', 'SUPPRESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'PENDING_RETRY', 'EXHAUSTED', 'SKIPPED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('WORKSPACE_MEMBER', 'CUSTOMER_CONTACT', 'DIRECT_RECIPIENT');

-- CreateEnum
CREATE TYPE "NotificationPreferenceScope" AS ENUM ('WORKSPACE', 'MEMBER', 'CUSTOMER');

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "sourceEntity" VARCHAR(64) NOT NULL,
    "sourceId" VARCHAR(64) NOT NULL,
    "dedupeKey" VARCHAR(128) NOT NULL,
    "actorMemberId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "sourceEntity" VARCHAR(64) NOT NULL,
    "sourceId" VARCHAR(64) NOT NULL,
    "actorMemberId" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipientType" "RecipientType" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "destination" VARCHAR(255) NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "providerMessageId" VARCHAR(255),
    "errorCode" VARCHAR(64),
    "errorMessage" TEXT,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" "NotificationEventType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "subject" VARCHAR(255),
    "bodyHtml" TEXT,
    "bodyText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" "NotificationPreferenceScope" NOT NULL,
    "scopeId" VARCHAR(64),
    "eventType" "NotificationEventType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "status" "NotificationDeliveryStatus" NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "providerMessageId" VARCHAR(255),
    "errorCode" VARCHAR(64),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InAppNotificationFeed" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "linkUrl" VARCHAR(512),
    "sourceEntity" VARCHAR(64),
    "sourceId" VARCHAR(64),
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InAppNotificationFeed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationOutbox_workspaceId_status_idx" ON "NotificationOutbox"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_createdAt_idx" ON "NotificationOutbox"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_workspaceId_dedupeKey_key" ON "NotificationOutbox"("workspaceId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_eventType_idx" ON "Notification"("workspaceId", "eventType");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_sourceEntity_sourceId_idx" ON "Notification"("workspaceId", "sourceEntity", "sourceId");

-- CreateIndex
CREATE INDEX "Notification_workspaceId_status_idx" ON "Notification"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_workspaceId_status_idx" ON "NotificationDelivery"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_recipientType_recipientId_idx" ON "NotificationDelivery"("recipientType", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_workspaceId_idempotencyKey_key" ON "NotificationDelivery"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationTemplate_workspaceId_eventType_idx" ON "NotificationTemplate"("workspaceId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTemplate_workspaceId_eventType_channel_locale_key" ON "NotificationTemplate"("workspaceId", "eventType", "channel", "locale");

-- CreateIndex
CREATE INDEX "NotificationPreference_workspaceId_scope_scopeId_idx" ON "NotificationPreference"("workspaceId", "scope", "scopeId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_workspaceId_scope_scopeId_eventType__key" ON "NotificationPreference"("workspaceId", "scope", "scopeId", "eventType", "channel");

-- CreateIndex
CREATE INDEX "NotificationLog_workspaceId_createdAt_idx" ON "NotificationLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_notificationId_idx" ON "NotificationLog"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationLog_deliveryId_idx" ON "NotificationLog"("deliveryId");

-- CreateIndex
CREATE INDEX "InAppNotificationFeed_workspaceId_memberId_isRead_isArchive_idx" ON "InAppNotificationFeed"("workspaceId", "memberId", "isRead", "isArchived");

-- CreateIndex
CREATE INDEX "InAppNotificationFeed_workspaceId_memberId_createdAt_idx" ON "InAppNotificationFeed"("workspaceId", "memberId", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "NotificationDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InAppNotificationFeed" ADD CONSTRAINT "InAppNotificationFeed_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
