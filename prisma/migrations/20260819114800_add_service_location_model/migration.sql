-- CreateTable
CREATE TABLE "ServiceLocation" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DECIMAL(65,30),
    "longitude" DECIMAL(65,30),
    "notes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceLocation_customerId_idx" ON "ServiceLocation"("customerId");

-- CreateIndex
CREATE INDEX "ServiceLocation_customerId_isPrimary_idx" ON "ServiceLocation"("customerId", "isPrimary");

-- CreateIndex (Partial unique index enforcing at most one primary service location per customer)
CREATE UNIQUE INDEX "ServiceLocation_customerId_isPrimary_key" ON "ServiceLocation"("customerId") WHERE ("isPrimary" = true);

-- AddForeignKey
ALTER TABLE "ServiceLocation" ADD CONSTRAINT "ServiceLocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
