-- CreateEnum
CREATE TYPE "ServiceAreaStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "ServiceArea" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ServiceAreaStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicianServiceArea" (
    "id" TEXT NOT NULL,
    "technicianProfileId" TEXT NOT NULL,
    "serviceAreaId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceArea_workspaceId_idx" ON "ServiceArea"("workspaceId");

-- CreateIndex
CREATE INDEX "ServiceArea_status_idx" ON "ServiceArea"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceArea_workspaceId_name_key" ON "ServiceArea"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "TechnicianServiceArea_technicianProfileId_idx" ON "TechnicianServiceArea"("technicianProfileId");

-- CreateIndex
CREATE INDEX "TechnicianServiceArea_serviceAreaId_idx" ON "TechnicianServiceArea"("serviceAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianServiceArea_technicianProfileId_serviceAreaId_key" ON "TechnicianServiceArea"("technicianProfileId", "serviceAreaId");

-- AddForeignKey
ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianServiceArea" ADD CONSTRAINT "TechnicianServiceArea_technicianProfileId_fkey" FOREIGN KEY ("technicianProfileId") REFERENCES "TechnicianProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnicianServiceArea" ADD CONSTRAINT "TechnicianServiceArea_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
