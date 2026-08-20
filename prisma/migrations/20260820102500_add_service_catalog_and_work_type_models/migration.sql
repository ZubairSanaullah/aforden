-- CreateEnum
CREATE TYPE "ServiceCatalogStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "WorkTypeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "ServiceCatalog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ServiceCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkType" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "estimatedDuration" INTEGER,
    "status" "WorkTypeStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCatalog_workspaceId_name_key" ON "ServiceCatalog"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "ServiceCatalog_workspaceId_idx" ON "ServiceCatalog"("workspaceId");

-- CreateIndex
CREATE INDEX "ServiceCatalog_status_idx" ON "ServiceCatalog"("status");

-- CreateIndex
CREATE INDEX "ServiceCatalog_workspaceId_status_idx" ON "ServiceCatalog"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ServiceCatalog_sortOrder_idx" ON "ServiceCatalog"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WorkType_catalogId_name_key" ON "WorkType"("catalogId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkType_workspaceId_code_key" ON "WorkType"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "WorkType_workspaceId_idx" ON "WorkType"("workspaceId");

-- CreateIndex
CREATE INDEX "WorkType_catalogId_idx" ON "WorkType"("catalogId");

-- CreateIndex
CREATE INDEX "WorkType_status_idx" ON "WorkType"("status");

-- CreateIndex
CREATE INDEX "WorkType_workspaceId_status_idx" ON "WorkType"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkType_sortOrder_idx" ON "WorkType"("sortOrder");

-- AddForeignKey
ALTER TABLE "ServiceCatalog" ADD CONSTRAINT "ServiceCatalog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkType" ADD CONSTRAINT "WorkType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkType" ADD CONSTRAINT "WorkType_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "ServiceCatalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
