-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AssetStatus" AS ENUM ('OPERATIONAL', 'DEGRADED', 'OUT_OF_SERVICE', 'IN_STORAGE', 'DECOMMISSIONED', 'RETIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AssetCategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "AssetHistoryEventType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'LOCATION_TRANSFERRED', 'OWNERSHIP_TRANSFERRED', 'DECOMMISSIONED', 'REACTIVATED', 'RETIRED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "assetId" TEXT;

-- CreateTable AssetCategory
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "status" "AssetCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable Asset
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "customerId" TEXT,
    "locationId" TEXT,
    "categoryId" TEXT,
    "assetNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "modelNumber" TEXT,
    "serialNumber" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'OPERATIONAL',
    "subLocationNotes" TEXT,
    "installationDate" TIMESTAMP(3),
    "warrantyExpiresAt" TIMESTAMP(3),
    "purchaseDate" TIMESTAMP(3),
    "purchaseCost" DECIMAL(12,2),
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "decommissionedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable AssetHistory
CREATE TABLE "AssetHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "eventType" "AssetHistoryEventType" NOT NULL,
    "actorUserId" TEXT,
    "actorRole" "MembershipRole" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex for AssetCategory
CREATE INDEX "AssetCategory_workspaceId_idx" ON "AssetCategory"("workspaceId");
CREATE INDEX "AssetCategory_status_idx" ON "AssetCategory"("status");
CREATE INDEX "AssetCategory_workspaceId_status_idx" ON "AssetCategory"("workspaceId", "status");
CREATE INDEX "AssetCategory_sortOrder_idx" ON "AssetCategory"("sortOrder");
CREATE UNIQUE INDEX "AssetCategory_workspaceId_name_key" ON "AssetCategory"("workspaceId", "name");
CREATE UNIQUE INDEX "AssetCategory_workspaceId_code_key" ON "AssetCategory"("workspaceId", "code");

-- CreateIndex for Asset
CREATE INDEX "Asset_workspaceId_idx" ON "Asset"("workspaceId");
CREATE INDEX "Asset_customerId_idx" ON "Asset"("customerId");
CREATE INDEX "Asset_locationId_idx" ON "Asset"("locationId");
CREATE INDEX "Asset_categoryId_idx" ON "Asset"("categoryId");
CREATE INDEX "Asset_status_idx" ON "Asset"("status");
CREATE INDEX "Asset_workspaceId_status_idx" ON "Asset"("workspaceId", "status");
CREATE INDEX "Asset_workspaceId_serialNumber_idx" ON "Asset"("workspaceId", "serialNumber");
CREATE INDEX "Asset_workspaceId_modelNumber_idx" ON "Asset"("workspaceId", "modelNumber");
CREATE INDEX "Asset_workspaceId_manufacturer_idx" ON "Asset"("workspaceId", "manufacturer");
CREATE INDEX "Asset_tags_idx" ON "Asset" USING GIN ("tags");
CREATE UNIQUE INDEX "Asset_workspaceId_assetNumber_key" ON "Asset"("workspaceId", "assetNumber");

-- CreateIndex for AssetHistory
CREATE INDEX "AssetHistory_workspaceId_idx" ON "AssetHistory"("workspaceId");
CREATE INDEX "AssetHistory_assetId_idx" ON "AssetHistory"("assetId");
CREATE INDEX "AssetHistory_workspaceId_assetId_createdAt_idx" ON "AssetHistory"("workspaceId", "assetId", "createdAt");

-- CreateIndex for WorkOrder.assetId
CREATE INDEX "WorkOrder_assetId_idx" ON "WorkOrder"("assetId");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey for AssetCategory
ALTER TABLE "AssetCategory" ADD CONSTRAINT "AssetCategory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey for Asset
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey for AssetHistory
ALTER TABLE "AssetHistory" ADD CONSTRAINT "AssetHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetHistory" ADD CONSTRAINT "AssetHistory_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetHistory" ADD CONSTRAINT "AssetHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
