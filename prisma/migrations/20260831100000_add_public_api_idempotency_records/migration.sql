-- CreateEnum
CREATE TYPE "ApiIdempotencyStatus" AS ENUM ('PENDING', 'RESOLVED', 'FAILED');

-- CreateTable
CREATE TABLE "ApiIdempotencyRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "scopedKeyHash" VARCHAR(64) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "status" "ApiIdempotencyStatus" NOT NULL DEFAULT 'PENDING',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "responseHeaders" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiIdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiIdempotencyRecord_scopedKeyHash_key" ON "ApiIdempotencyRecord"("scopedKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiIdempotencyRecord_workspaceId_apiKeyId_endpoint_idempotencyKey_key" ON "ApiIdempotencyRecord"("workspaceId", "apiKeyId", "endpoint", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ApiIdempotencyRecord_workspaceId_createdAt_idx" ON "ApiIdempotencyRecord"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiIdempotencyRecord_apiKeyId_createdAt_idx" ON "ApiIdempotencyRecord"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiIdempotencyRecord_expiresAt_idx" ON "ApiIdempotencyRecord"("expiresAt");

-- AddForeignKey
ALTER TABLE "ApiIdempotencyRecord" ADD CONSTRAINT "ApiIdempotencyRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiIdempotencyRecord" ADD CONSTRAINT "ApiIdempotencyRecord_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
