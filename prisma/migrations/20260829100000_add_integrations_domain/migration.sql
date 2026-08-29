-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'DISABLED');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR', 'SUSPENDED_ENTITLEMENT');

-- CreateEnum
CREATE TYPE "IntegrationCredentialStatus" AS ENUM ('ACTIVE', 'ROTATING', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "IntegrationWebhookStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "IntegrationExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "IntegrationCapability" AS ENUM ('EMAIL_SEND', 'SMS_SEND', 'CALENDAR_WRITE', 'CALENDAR_READ', 'ACCOUNTING_INVOICE_SYNC', 'ACCOUNTING_PAYMENT_SYNC', 'ACCOUNTING_CUSTOMER_SYNC', 'FILE_UPLOAD', 'FILE_DOWNLOAD', 'WEBHOOK_RECEIVE', 'CRM_CONTACT_SYNC');

-- CreateEnum
CREATE TYPE "IntegrationFailureCode" AS ENUM ('AUTHENTICATION_FAILED', 'TOKEN_EXPIRED', 'RATE_LIMITED', 'NETWORK_TIMEOUT', 'SERVICE_UNAVAILABLE', 'BAD_REQUEST', 'PAYLOAD_VALIDATION_FAILED', 'RESOURCE_NOT_FOUND', 'CAPABILITY_UNSUPPORTED', 'ENTITLEMENT_BLOCKED', 'INTERNAL_ADAPTER_ERROR');

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "capabilities" "IntegrationCapability"[],
    "configSchemaJson" JSONB,
    "authType" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "connectionKey" VARCHAR(64) NOT NULL DEFAULT 'default',
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "configJson" JSONB,
    "metadataJson" JSONB,
    "externalAccountId" VARCHAR(255),
    "externalAccountName" VARCHAR(255),
    "lastTestedAt" TIMESTAMP(3),
    "lastErrorJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "IntegrationCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "keyVaultProvider" VARCHAR(64) NOT NULL DEFAULT 'AWS_KMS',
    "algorithm" VARCHAR(64) NOT NULL DEFAULT 'AES_256_GCM',
    "iv" VARCHAR(255) NOT NULL,
    "tag" VARCHAR(255) NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "encryptedDek" TEXT,
    "fingerprint" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationWebhook" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "endpointSlug" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "IntegrationWebhookStatus" NOT NULL DEFAULT 'ACTIVE',
    "secretRefId" VARCHAR(255),
    "enabledEvents" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationExecution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "capability" "IntegrationCapability" NOT NULL,
    "action" VARCHAR(128) NOT NULL,
    "status" "IntegrationExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "correlationId" VARCHAR(255) NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "requestSnapshotJson" JSONB,
    "responseSnapshotJson" JSONB,
    "rawResponseStatus" INTEGER,
    "providerRequestId" VARCHAR(255),
    "durationMs" INTEGER,
    "failureCode" "IntegrationFailureCode",
    "failureJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationWebhookEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerEventId" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(128),
    "status" VARCHAR(64) NOT NULL DEFAULT 'RECEIVED',
    "headersJson" JSONB,
    "payloadJson" JSONB,
    "errorJson" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceActiveExclusiveCapability" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "capability" "IntegrationCapability" NOT NULL,
    "connectionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceActiveExclusiveCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceIntegrationSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "defaultProvidersJson" JSONB,
    "settingsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceIntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Integration_status_idx" ON "Integration"("status");

-- CreateIndex
CREATE INDEX "IntegrationConnection_workspaceId_status_idx" ON "IntegrationConnection"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "IntegrationConnection_integrationId_idx" ON "IntegrationConnection"("integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_workspaceId_integrationId_connectionKey_key" ON "IntegrationConnection"("workspaceId", "integrationId", "connectionKey");

-- CreateIndex
CREATE INDEX "IntegrationCredential_connectionId_status_idx" ON "IntegrationCredential"("connectionId", "status");

-- CreateIndex
CREATE INDEX "IntegrationCredential_fingerprint_idx" ON "IntegrationCredential"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_connectionId_version_key" ON "IntegrationCredential"("connectionId", "version");

-- CreateIndex: Enforce Single Active Credential Invariant (§3.5 of Phase 1.17.1 Architecture Spec)
CREATE UNIQUE INDEX "unique_active_credential_per_connection"
ON "IntegrationCredential"("connectionId")
WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationWebhook_endpointSlug_key" ON "IntegrationWebhook"("endpointSlug");

-- CreateIndex
CREATE INDEX "IntegrationWebhook_workspaceId_status_idx" ON "IntegrationWebhook"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "IntegrationWebhook_connectionId_idx" ON "IntegrationWebhook"("connectionId");

-- CreateIndex
CREATE INDEX "IntegrationExecution_workspaceId_createdAt_idx" ON "IntegrationExecution"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationExecution_connectionId_createdAt_idx" ON "IntegrationExecution"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationExecution_idempotencyKey_idx" ON "IntegrationExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IntegrationExecution_correlationId_idx" ON "IntegrationExecution"("correlationId");

-- CreateIndex
CREATE INDEX "IntegrationExecution_workspaceId_status_createdAt_idx" ON "IntegrationExecution"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationWebhookEvent_workspaceId_createdAt_idx" ON "IntegrationWebhookEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationWebhookEvent_connectionId_createdAt_idx" ON "IntegrationWebhookEvent"("connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationWebhookEvent_connectionId_providerEventId_key" ON "IntegrationWebhookEvent"("connectionId", "providerEventId");

-- CreateIndex
CREATE INDEX "WorkspaceActiveExclusiveCapability_workspaceId_idx" ON "WorkspaceActiveExclusiveCapability"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceActiveExclusiveCapability_connectionId_idx" ON "WorkspaceActiveExclusiveCapability"("connectionId");

-- CreateIndex: Enforce Exclusive Capability Singleton Invariant (§2.4 of Phase 1.17.1 Architecture Spec)
CREATE UNIQUE INDEX "WorkspaceActiveExclusiveCapability_workspaceId_capability_key" ON "WorkspaceActiveExclusiveCapability"("workspaceId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceIntegrationSetting_workspaceId_key" ON "WorkspaceIntegrationSetting"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceIntegrationSetting_workspaceId_idx" ON "WorkspaceIntegrationSetting"("workspaceId");

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationWebhook" ADD CONSTRAINT "IntegrationWebhook_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationWebhook" ADD CONSTRAINT "IntegrationWebhook_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationExecution" ADD CONSTRAINT "IntegrationExecution_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationExecution" ADD CONSTRAINT "IntegrationExecution_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationWebhookEvent" ADD CONSTRAINT "IntegrationWebhookEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationWebhookEvent" ADD CONSTRAINT "IntegrationWebhookEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceActiveExclusiveCapability" ADD CONSTRAINT "WorkspaceActiveExclusiveCapability_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceActiveExclusiveCapability" ADD CONSTRAINT "WorkspaceActiveExclusiveCapability_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceIntegrationSetting" ADD CONSTRAINT "WorkspaceIntegrationSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
