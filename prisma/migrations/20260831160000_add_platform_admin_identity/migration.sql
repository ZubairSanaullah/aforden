-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_OPERATIONS', 'PLATFORM_SECURITY', 'PLATFORM_BILLING');

-- CreateEnum
CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "platformRole" "PlatformRole";

-- CreateTable
CREATE TABLE "PlatformAdminProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastActiveAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "stepUpConfirmedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAdminProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdminProfile_userId_key" ON "PlatformAdminProfile"("userId");

-- CreateIndex
CREATE INDEX "PlatformAdminProfile_status_idx" ON "PlatformAdminProfile"("status");

-- CreateIndex
CREATE INDEX "PlatformAdminProfile_lastActiveAt_idx" ON "PlatformAdminProfile"("lastActiveAt");

-- CreateIndex
CREATE INDEX "User_platformRole_idx" ON "User"("platformRole");

-- AddForeignKey
ALTER TABLE "PlatformAdminProfile" ADD CONSTRAINT "PlatformAdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
