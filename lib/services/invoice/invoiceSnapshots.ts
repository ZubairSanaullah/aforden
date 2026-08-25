/**
 * Phase 1.12.4 — Invoicing & Payments Independent Snapshot Helpers
 * Pure snapshot transformers and catalog resolvers ensuring complete historical
 * financial isolation between Invoices, Quotes, WorkOrders, and Catalog entities.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { InvoiceLineItemType } from "./invoice.types";

type DatabaseClient = Prisma.TransactionClient | typeof prisma;

export interface WorkTypeSnapshotResult {
    workTypeId: string;
    workTypeName: string;
    workTypeCode: string | null;
}

export interface PartSnapshotResult {
    partId: string;
    partName: string;
    partSku: string | null;
    partUnitOfMeasure: string;
    unitCost: Prisma.Decimal | null;
}

export interface StandaloneLineItemSnapshotInput {
    lineItemType?: InvoiceLineItemType;
    workTypeId?: string | null;
    partId?: string | null;
    name?: string;
    description?: string | null;
    quantity?: number | string | Prisma.Decimal;
    unitPrice?: number | string | Prisma.Decimal;
    unitCost?: number | string | Prisma.Decimal | null;
    discountAmount?: number | string | Prisma.Decimal;
    taxRate?: number | string | Prisma.Decimal | null;
    sortOrder?: number;
}

export interface ResolvedInvoiceLineItemSnapshot {
    lineItemType: InvoiceLineItemType;
    workTypeId: string | null;
    partId: string | null;
    name: string;
    description: string | null;
    workTypeName: string | null;
    workTypeCode: string | null;
    partName: string | null;
    partSku: string | null;
    partUnitOfMeasure: string | null;
    unitPrice: Prisma.Decimal;
    unitCost: Prisma.Decimal | null;
    quantity: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    sortOrder: number;
}

/**
 * Pure function: takes already-fetched QuoteLineItem records and deep-copies
 * them into independent InvoiceLineItem creation shapes.
 * Retains zero shared references to the source QuoteLineItem objects.
 */
export function snapshotLineItemsFromQuote(
    quoteLineItems: any[],
): ResolvedInvoiceLineItemSnapshot[] {
    if (!Array.isArray(quoteLineItems) || quoteLineItems.length === 0) {
        return [];
    }

    return quoteLineItems.map((item, index) => {
        const qty = item.quantity !== undefined && item.quantity !== null
            ? new Prisma.Decimal(String(item.quantity))
            : new Prisma.Decimal("1.00");

        const unitPrice = item.unitPrice !== undefined && item.unitPrice !== null
            ? new Prisma.Decimal(String(item.unitPrice))
            : new Prisma.Decimal("0.00");

        const unitCost = item.unitCost !== undefined && item.unitCost !== null
            ? new Prisma.Decimal(String(item.unitCost))
            : null;

        const discountAmount = item.discountAmount !== undefined && item.discountAmount !== null
            ? new Prisma.Decimal(String(item.discountAmount))
            : new Prisma.Decimal("0.00");

        const taxRate = item.taxRate !== undefined && item.taxRate !== null
            ? new Prisma.Decimal(String(item.taxRate))
            : new Prisma.Decimal("0.0000");

        const sortOrder = typeof item.sortOrder === "number" ? item.sortOrder : index;

        return {
            lineItemType: (item.lineItemType as InvoiceLineItemType) ?? "CUSTOM",
            workTypeId: item.workTypeId ? String(item.workTypeId) : null,
            partId: item.partId ? String(item.partId) : null,
            name: String(item.name || "Line Item"),
            description: item.description ? String(item.description) : null,
            workTypeName: item.workTypeName ? String(item.workTypeName) : null,
            workTypeCode: item.workTypeCode ? String(item.workTypeCode) : null,
            partName: item.partName ? String(item.partName) : null,
            partSku: item.partSku ? String(item.partSku) : null,
            partUnitOfMeasure: item.partUnitOfMeasure ? String(item.partUnitOfMeasure) : null,
            quantity: qty,
            unitPrice,
            unitCost,
            discountAmount,
            taxRate,
            sortOrder,
        };
    });
}

/**
 * Pure function: takes an already-fetched WorkOrder record (with workType and parts/workOrderParts)
 * and derives independent LABOR and PART InvoiceLineItem shapes per 1.12.1 §2.2.
 */
export function snapshotLineItemsFromWorkOrder(
    workOrder: any,
): ResolvedInvoiceLineItemSnapshot[] {
    if (!workOrder) {
        return [];
    }

    const lines: ResolvedInvoiceLineItemSnapshot[] = [];
    let currentSortOrder = 0;

    // 1. Derive Primary LABOR line if WorkOrder has an associated WorkType or title
    if (workOrder.workType || workOrder.workTypeId) {
        const wt = workOrder.workType;
        const workTypeId = wt?.id ? String(wt.id) : (workOrder.workTypeId ? String(workOrder.workTypeId) : null);
        const workTypeName = wt?.name ? String(wt.name) : "Labor Services";
        const workTypeCode = wt?.code ? String(wt.code) : null;
        const name = wt?.name ? String(wt.name) : (workOrder.title ? String(workOrder.title) : "Labor Services");
        const description = wt?.description ? String(wt.description) : (workOrder.description ? String(workOrder.description) : null);

        let quantityDecimal = new Prisma.Decimal("1.00");
        if (workOrder.billableHours !== undefined && workOrder.billableHours !== null) {
            quantityDecimal = new Prisma.Decimal(String(workOrder.billableHours));
        } else if (wt?.estimatedDuration !== undefined && wt?.estimatedDuration !== null) {
            quantityDecimal = new Prisma.Decimal(String(wt.estimatedDuration));
        } else if (wt?.estimatedDurationHours !== undefined && wt?.estimatedDurationHours !== null) {
            quantityDecimal = new Prisma.Decimal(String(wt.estimatedDurationHours));
        }

        let unitPriceDecimal = new Prisma.Decimal("0.00");
        if (workOrder.laborRate !== undefined && workOrder.laborRate !== null) {
            unitPriceDecimal = new Prisma.Decimal(String(workOrder.laborRate));
        } else if (wt?.standardRate !== undefined && wt?.standardRate !== null) {
            unitPriceDecimal = new Prisma.Decimal(String(wt.standardRate));
        }

        lines.push({
            lineItemType: "LABOR",
            workTypeId,
            partId: null,
            name,
            description,
            workTypeName,
            workTypeCode,
            partName: null,
            partSku: null,
            partUnitOfMeasure: null,
            quantity: quantityDecimal,
            unitPrice: unitPriceDecimal,
            unitCost: null,
            discountAmount: new Prisma.Decimal("0.00"),
            taxRate: new Prisma.Decimal("0.0000"),
            sortOrder: currentSortOrder++,
        });
    }

    // 2. Derive PART lines from consumed WorkOrder parts
    const partsList = Array.isArray(workOrder.workOrderParts)
        ? workOrder.workOrderParts
        : Array.isArray(workOrder.parts)
        ? workOrder.parts
        : [];

    for (const p of partsList) {
        const partObj = p.part ?? p;
        const partId = p.partId ? String(p.partId) : (partObj?.id ? String(partObj.id) : null);
        const partName = partObj?.name ? String(partObj.name) : (p.partName ? String(p.partName) : "Part");
        const partSku = partObj?.sku ? String(partObj.sku) : (p.partSku ? String(p.partSku) : null);
        const partUnitOfMeasure = partObj?.unitOfMeasure ? String(partObj.unitOfMeasure) : (p.partUnitOfMeasure ? String(p.partUnitOfMeasure) : "unit");
        const name = partName;
        const description = partObj?.description ? String(partObj.description) : (p.description ? String(p.description) : null);

        const quantityDecimal = p.quantity !== undefined && p.quantity !== null
            ? new Prisma.Decimal(String(p.quantity))
            : new Prisma.Decimal("1.00");

        let unitPriceDecimal = new Prisma.Decimal("0.00");
        if (p.unitPrice !== undefined && p.unitPrice !== null) {
            unitPriceDecimal = new Prisma.Decimal(String(p.unitPrice));
        } else if (partObj?.unitPrice !== undefined && partObj?.unitPrice !== null) {
            unitPriceDecimal = new Prisma.Decimal(String(partObj.unitPrice));
        }

        let unitCostDecimal: Prisma.Decimal | null = null;
        if (p.unitCostAtTimeOfUse !== undefined && p.unitCostAtTimeOfUse !== null) {
            unitCostDecimal = new Prisma.Decimal(String(p.unitCostAtTimeOfUse));
        } else if (p.unitCost !== undefined && p.unitCost !== null) {
            unitCostDecimal = new Prisma.Decimal(String(p.unitCost));
        } else if (partObj?.unitCost !== undefined && partObj?.unitCost !== null) {
            unitCostDecimal = new Prisma.Decimal(String(partObj.unitCost));
        }

        lines.push({
            lineItemType: "PART",
            workTypeId: null,
            partId,
            name,
            description,
            workTypeName: null,
            workTypeCode: null,
            partName,
            partSku,
            partUnitOfMeasure,
            quantity: quantityDecimal,
            unitPrice: unitPriceDecimal,
            unitCost: unitCostDecimal,
            discountAmount: new Prisma.Decimal("0.00"),
            taxRate: new Prisma.Decimal("0.0000"),
            sortOrder: currentSortOrder++,
        });
    }

    return lines;
}

/**
 * Resolves frozen snapshot fields from the Service Catalog WorkType record.
 */
export async function resolveInvoiceWorkTypeSnapshot(
    workspaceId: string,
    workTypeId: string,
    db: DatabaseClient = prisma,
): Promise<WorkTypeSnapshotResult | null> {
    const workType = await db.workType.findFirst({
        where: {
            id: workTypeId,
            workspaceId,
        },
        select: {
            id: true,
            name: true,
            code: true,
            status: true,
        },
    });

    if (!workType) {
        return null;
    }

    return {
        workTypeId: workType.id,
        workTypeName: workType.name,
        workTypeCode: workType.code,
    };
}

/**
 * Resolves frozen snapshot fields from the Inventory Part record.
 */
export async function resolveInvoicePartSnapshot(
    workspaceId: string,
    partId: string,
    db: DatabaseClient = prisma,
): Promise<PartSnapshotResult | null> {
    const part = await db.part.findFirst({
        where: {
            id: partId,
            workspaceId,
        },
        select: {
            id: true,
            name: true,
            sku: true,
            unitOfMeasure: true,
            unitCost: true,
            status: true,
        },
    });

    if (!part) {
        return null;
    }

    return {
        partId: part.id,
        partName: part.name,
        partSku: part.sku,
        partUnitOfMeasure: part.unitOfMeasure,
        unitCost: part.unitCost ? new Prisma.Decimal(part.unitCost) : null,
    };
}

/**
 * Resolves full frozen snapshot metadata for a standalone invoice line item.
 */
export async function resolveStandaloneLineItemSnapshot(
    workspaceId: string,
    input: StandaloneLineItemSnapshotInput,
    db: DatabaseClient = prisma,
): Promise<ResolvedInvoiceLineItemSnapshot> {
    let lineItemType: InvoiceLineItemType = input.lineItemType ?? "CUSTOM";
    let workTypeName: string | null = null;
    let workTypeCode: string | null = null;
    let partName: string | null = null;
    let partSku: string | null = null;
    let partUnitOfMeasure: string | null = null;

    let effectiveUnitCost: Prisma.Decimal | null =
        input.unitCost !== undefined && input.unitCost !== null
            ? new Prisma.Decimal(String(input.unitCost))
            : null;

    if (input.workTypeId) {
        const wt = await resolveInvoiceWorkTypeSnapshot(workspaceId, input.workTypeId, db);
        if (wt) {
            workTypeName = wt.workTypeName;
            workTypeCode = wt.workTypeCode;
            if (!input.lineItemType || input.lineItemType === "CUSTOM") {
                lineItemType = "LABOR";
            }
        }
    }

    if (input.partId) {
        const pt = await resolveInvoicePartSnapshot(workspaceId, input.partId, db);
        if (pt) {
            partName = pt.partName;
            partSku = pt.partSku;
            partUnitOfMeasure = pt.partUnitOfMeasure;
            if (!input.lineItemType || input.lineItemType === "CUSTOM") {
                lineItemType = "PART";
            }
            if (effectiveUnitCost === null && pt.unitCost !== null) {
                effectiveUnitCost = pt.unitCost;
            }
        }
    }

    const effectiveName =
        input.name && input.name.trim().length > 0
            ? input.name.trim()
            : workTypeName || partName || "Line Item";

    const finalUnitPrice = input.unitPrice !== undefined && input.unitPrice !== null
        ? new Prisma.Decimal(String(input.unitPrice))
        : new Prisma.Decimal("0.00");

    const finalQuantity = input.quantity !== undefined && input.quantity !== null
        ? new Prisma.Decimal(String(input.quantity))
        : new Prisma.Decimal("1.00");

    const finalDiscount = input.discountAmount !== undefined && input.discountAmount !== null
        ? new Prisma.Decimal(String(input.discountAmount))
        : new Prisma.Decimal("0.00");

    const finalTaxRate = input.taxRate !== undefined && input.taxRate !== null
        ? new Prisma.Decimal(String(input.taxRate))
        : new Prisma.Decimal("0.0000");

    return {
        lineItemType,
        workTypeId: input.workTypeId ?? null,
        partId: input.partId ?? null,
        name: effectiveName,
        description: input.description ?? null,
        workTypeName,
        workTypeCode,
        partName,
        partSku,
        partUnitOfMeasure,
        unitPrice: finalUnitPrice,
        unitCost: effectiveUnitCost,
        quantity: finalQuantity,
        discountAmount: finalDiscount,
        taxRate: finalTaxRate,
        sortOrder: input.sortOrder ?? 0,
    };
}
