-- CreateEnum
CREATE TYPE "TechnicianExceptionType" AS ENUM ('TIME_OFF', 'VACATION', 'SICK_LEAVE', 'PERSONAL_LEAVE', 'HOLIDAY', 'TRAINING', 'UNAVAILABLE', 'OTHER');

-- CreateEnum
CREATE TYPE "TechnicianAvailabilityExceptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "TechnicianAvailabilityException" (
    "id" TEXT NOT NULL,
    "technicianProfileId" TEXT NOT NULL,
    "type" "TechnicianExceptionType" NOT NULL,
    "status" "TechnicianAvailabilityExceptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TechnicianAvailabilityException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicianAvailabilityException_technicianProfileId_idx" ON "TechnicianAvailabilityException"("technicianProfileId");

-- CreateIndex
CREATE INDEX "TechnicianAvailabilityException_startsAt_idx" ON "TechnicianAvailabilityException"("startsAt");

-- CreateIndex
CREATE INDEX "TechnicianAvailabilityException_endsAt_idx" ON "TechnicianAvailabilityException"("endsAt");

-- CreateIndex
CREATE INDEX "TechnicianAvailabilityException_status_idx" ON "TechnicianAvailabilityException"("status");

-- CreateIndex
CREATE INDEX "TechnicianAvailabilityException_type_idx" ON "TechnicianAvailabilityException"("type");

-- AddForeignKey
ALTER TABLE "TechnicianAvailabilityException" ADD CONSTRAINT "TechnicianAvailabilityException_technicianProfileId_fkey" FOREIGN KEY ("technicianProfileId") REFERENCES "TechnicianProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
