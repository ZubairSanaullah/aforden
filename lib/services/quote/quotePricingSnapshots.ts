/**
 * Phase 1.11.4 — Quotes & Estimates Catalog Freeze / Pricing Snapshot Helpers
 * Pure read-only snapshot resolvers for WorkTypes and Parts to ensure historical
 * quote accuracy against future catalog mutations or deletions.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { QuoteLineItemType } from "./quote.types";

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

export interface ResolvedLineItemSnapshot {
    lineItemType: QuoteLineItemType;
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
    taxRate: Prisma.Decimal | null;
    sortOrder: number;
}

type DatabaseClient = Prisma.TransactionClient | typeof prisma;

/**
 * Resolves frozen snapshot fields from the Service Catalog WorkType record.
 */
export async function resolveWorkTypeSnapshot(
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
export async function resolvePartSnapshot(
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
 * Merges caller-supplied line item input with catalog snapshots.
 * Automatically populates snapshot fields and defaults line item type/name/cost when omitted.
 */
export async function resolveLineItemSnapshot(
    workspaceId: string,
    item: {
        lineItemType?: QuoteLineItemType;
        workTypeId?: string | null;
        partId?: string | null;
        name?: string;
        description?: string | null;
        quantity?: number | string | Prisma.Decimal;
        unitPrice?: number | string | Prisma.Decimal;
        unitCost?: number | string | Prisma.Decimal | null;
        discountAmount?: number | string | Prisma.Decimal | null;
        taxRate?: number | string | Prisma.Decimal | null;
        sortOrder?: number;
    },
    db: DatabaseClient = prisma,
): Promise<ResolvedLineItemSnapshot> {
    let lineItemType: QuoteLineItemType = item.lineItemType ?? "CUSTOM";
    let workTypeName: string | null = null;
    let workTypeCode: string | null = null;
    let partName: string | null = null;
    let partSku: string | null = null;
    let partUnitOfMeasure: string | null = null;

    let effectiveUnitCost: Prisma.Decimal | null =
        item.unitCost !== undefined && item.unitCost !== null
            ? new Prisma.Decimal(item.unitCost)
            : null;

    // 1. Resolve WorkType snapshot if workTypeId is present
    if (item.workTypeId) {
        const wtSnapshot = await resolveWorkTypeSnapshot(workspaceId, item.workTypeId, db);
        if (wtSnapshot) {
            workTypeName = wtSnapshot.workTypeName;
            workTypeCode = wtSnapshot.workTypeCode;
            if (!item.lineItemType) {
                lineItemType = "LABOR";
            }
        }
    }

    // 2. Resolve Part snapshot if partId is present
    if (item.partId) {
        const partSnapshot = await resolvePartSnapshot(workspaceId, item.partId, db);
        if (partSnapshot) {
            partName = partSnapshot.partName;
            partSku = partSnapshot.partSku;
            partUnitOfMeasure = partSnapshot.partUnitOfMeasure;
            if (!item.lineItemType) {
                lineItemType = "PART";
            }
            if (effectiveUnitCost === null && partSnapshot.unitCost !== null) {
                effectiveUnitCost = partSnapshot.unitCost;
            }
        }
    }

    // 3. Fallback name resolution
    const effectiveName =
        item.name && item.name.trim().length > 0
            ? item.name.trim()
            : workTypeName || partName || "Untitled Item";

    const quantity = item.quantity !== undefined
        ? new Prisma.Decimal(item.quantity)
        : new Prisma.Decimal("1.00");

    const unitPrice = item.unitPrice !== undefined
        ? new Prisma.Decimal(item.unitPrice)
        : new Prisma.Decimal("0.00");

    const discountAmount = item.discountAmount !== undefined && item.discountAmount !== null
        ? new Prisma.Decimal(item.discountAmount)
        : new Prisma.Decimal("0.00");

    const taxRate = item.taxRate !== undefined && item.taxRate !== null
        ? new Prisma.Decimal(item.taxRate)
        : null;

    return {
        lineItemType,
        workTypeId: item.workTypeId ?? null,
        partId: item.partId ?? null,
        name: effectiveName,
        description: item.description ?? null,
        workTypeName,
        workTypeCode,
        partName,
        partSku,
        partUnitOfMeasure,
        quantity,
        unitPrice,
        unitCost: effectiveUnitCost,
        discountAmount,
        taxRate,
        sortOrder: item.sortOrder ?? 0,
    };
}
