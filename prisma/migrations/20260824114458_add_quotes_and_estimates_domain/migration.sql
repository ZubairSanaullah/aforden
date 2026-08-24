-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "QuoteLineItemType" AS ENUM ('LABOR', 'PART', 'EXPENSE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "QuoteDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "QuoteHistoryEventType" AS ENUM ('CREATED', 'UPDATED', 'LINE_ITEM_ADDED', 'LINE_ITEM_UPDATED', 'LINE_ITEM_REMOVED', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONVERTED', 'DELETED');

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "sourceQuoteId" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "defaultCurrencyCode" VARCHAR(3) NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "internalNotes" TEXT,
    "termsAndConditions" TEXT,
    "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "validUntil" TIMESTAMP(3),
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "discountType" "QuoteDiscountType" NOT NULL DEFAULT 'PERCENTAGE',
    "discountValue" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.00,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "sentAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByCustomerName" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedWorkOrderId" TEXT,
    "convertedByMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lineItemType" "QuoteLineItemType" NOT NULL DEFAULT 'CUSTOM',
    "workTypeId" TEXT,
    "partId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workTypeName" TEXT,
    "workTypeCode" TEXT,
    "partName" TEXT,
    "partSku" TEXT,
    "partUnitOfMeasure" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "unitCost" DECIMAL(12,2),
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "taxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.00,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteHistory" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" "QuoteHistoryEventType" NOT NULL,
    "actorMemberId" TEXT,
    "actorName" TEXT,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quote_workspaceId_idx" ON "Quote"("workspaceId");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Quote_locationId_idx" ON "Quote"("locationId");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "Quote_workspaceId_status_idx" ON "Quote"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Quote_validUntil_idx" ON "Quote"("validUntil");

-- CreateIndex
CREATE INDEX "Quote_createdAt_idx" ON "Quote"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_workspaceId_quoteNumber_key" ON "Quote"("workspaceId", "quoteNumber");

-- CreateIndex
CREATE INDEX "QuoteLineItem_quoteId_idx" ON "QuoteLineItem"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteLineItem_workspaceId_idx" ON "QuoteLineItem"("workspaceId");

-- CreateIndex
CREATE INDEX "QuoteLineItem_workTypeId_idx" ON "QuoteLineItem"("workTypeId");

-- CreateIndex
CREATE INDEX "QuoteLineItem_partId_idx" ON "QuoteLineItem"("partId");

-- CreateIndex
CREATE INDEX "QuoteLineItem_sortOrder_idx" ON "QuoteLineItem"("sortOrder");

-- CreateIndex
CREATE INDEX "QuoteHistory_quoteId_idx" ON "QuoteHistory"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteHistory_workspaceId_idx" ON "QuoteHistory"("workspaceId");

-- CreateIndex
CREATE INDEX "QuoteHistory_eventType_idx" ON "QuoteHistory"("eventType");

-- CreateIndex
CREATE INDEX "QuoteHistory_createdAt_idx" ON "QuoteHistory"("createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_sourceQuoteId_idx" ON "WorkOrder"("sourceQuoteId");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_sourceQuoteId_fkey" FOREIGN KEY ("sourceQuoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "WorkType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteHistory" ADD CONSTRAINT "QuoteHistory_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteHistory" ADD CONSTRAINT "QuoteHistory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
