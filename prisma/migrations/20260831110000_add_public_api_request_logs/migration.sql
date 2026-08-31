-- CreateTable
CREATE TABLE "ApiRequestLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "developerApplicationId" TEXT,
    "requestId" VARCHAR(64) NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ipHash" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "apiVersion" VARCHAR(16) NOT NULL DEFAULT 'v1',
    "rateLimitTier" VARCHAR(32),
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiRequestLog_workspaceId_createdAt_idx" ON "ApiRequestLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_workspaceId_apiKeyId_createdAt_idx" ON "ApiRequestLog"("workspaceId", "apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_workspaceId_statusCode_idx" ON "ApiRequestLog"("workspaceId", "statusCode");

-- CreateIndex
CREATE INDEX "ApiRequestLog_requestId_idx" ON "ApiRequestLog"("requestId");

-- AddForeignKey
ALTER TABLE "ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
