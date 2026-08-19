-- CreateEnum
CREATE TYPE "AvailabilityDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "TechnicianAvailabilityStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "TechnicianAvailability" (
    "id" TEXT NOT NULL,
    "technicianProfileId" TEXT NOT NULL,
    "dayOfWeek" "AvailabilityDay" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" "TechnicianAvailabilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianAvailability_technicianProfileId_idx" ON "TechnicianAvailability"("technicianProfileId");

-- CreateIndex
CREATE INDEX "TechnicianAvailability_dayOfWeek_idx" ON "TechnicianAvailability"("dayOfWeek");

-- CreateIndex
CREATE INDEX "TechnicianAvailability_status_idx" ON "TechnicianAvailability"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicianAvailability_technicianProfileId_dayOfWeek_startT_key" ON "TechnicianAvailability"("technicianProfileId", "dayOfWeek", "startTime", "endTime");

-- AddForeignKey
ALTER TABLE "TechnicianAvailability" ADD CONSTRAINT "TechnicianAvailability_technicianProfileId_fkey" FOREIGN KEY ("technicianProfileId") REFERENCES "TechnicianProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
