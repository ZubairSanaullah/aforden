-- CreateEnum
CREATE TYPE "DeveloperApplicationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ApiKeyEnvironment" AS ENUM ('LIVE', 'TEST');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "DeveloperApplication" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "DeveloperApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeveloperApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "developerApplicationId" TEXT NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "keyPrefix" VARCHAR(32) NOT NULL,
    "environment" "ApiKeyEnvironment" NOT NULL DEFAULT 'LIVE',
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeveloperApplication_workspaceId_idx" ON "DeveloperApplication"("workspaceId");

-- CreateIndex
CREATE INDEX "DeveloperApplication_workspaceId_status_idx" ON "DeveloperApplication"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "DeveloperApplication_createdByUserId_idx" ON "DeveloperApplication"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_developerApplicationId_idx" ON "ApiKey"("developerApplicationId");

-- CreateIndex
CREATE INDEX "ApiKey_developerApplicationId_status_idx" ON "ApiKey"("developerApplicationId", "status");

-- CreateIndex
CREATE INDEX "ApiKey_status_expiresAt_idx" ON "ApiKey"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "DeveloperApplication" ADD CONSTRAINT "DeveloperApplication_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeveloperApplication" ADD CONSTRAINT "DeveloperApplication_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_developerApplicationId_fkey" FOREIGN KEY ("developerApplicationId") REFERENCES "DeveloperApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
