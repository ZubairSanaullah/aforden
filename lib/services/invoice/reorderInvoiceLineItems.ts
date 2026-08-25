/**
 * Phase 1.12.6 — Reorder Invoice Line Items Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    InvoiceNotFoundError,
    InvoiceLineItemNotFoundError,
    InvoiceStatusConflictError,
} from "./invoiceErrors";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Reorders line items within an Invoice in DRAFT status.
 * Updates sortOrder for all line items atomically and records an audit history entry.
 */
export async function reorderInvoiceLineItems(
    workspaceId: string,
    invoiceId: string,
    orderedLineItemIds: string[],
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.update
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_UPDATE);

    // 3. RESOLUTION & INVARIANTS
    const invoice = await prisma.invoice.findFirst({
        where: {
            id: invoiceId,
            workspaceId,
        },
        include: {
            lineItems: {
                orderBy: { sortOrder: "asc" },
            },
            payments: true,
        },
    });

    if (!invoice) {
        throw new InvoiceNotFoundError();
    }

    // Lifecycle Guard: Only DRAFT invoices permit reordering
    if (invoice.status !== "DRAFT") {
        throw new InvoiceStatusConflictError(
            `Invoices in ${invoice.status} status cannot be edited. Only DRAFT invoices can be modified.`,
        );
    }

    // 4. VALIDATION OF ORDERED IDS
    if (!Array.isArray(orderedLineItemIds)) {
        throw new Error("Invalid line item order: orderedLineItemIds must be an array of IDs.");
    }

    if (orderedLineItemIds.length !== invoice.lineItems.length) {
        throw new Error(
            `Invalid line item order: expected ${invoice.lineItems.length} IDs, received ${orderedLineItemIds.length}.`,
        );
    }

    const currentIdSet = new Set(invoice.lineItems.map((l) => l.id));
    const uniqueIncomingIds = new Set(orderedLineItemIds);

    if (uniqueIncomingIds.size !== orderedLineItemIds.length) {
        throw new Error("Invalid line item order: duplicate line item IDs provided.");
    }

    for (const id of orderedLineItemIds) {
        if (!currentIdSet.has(id)) {
            throw new InvoiceLineItemNotFoundError(
                `Line item ${id} does not belong to this invoice or workspace.`,
            );
        }
    }

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updatedInvoice = await runTx(async (tx) => {
        // 1. Update sortOrder for each line item
        for (let i = 0; i < orderedLineItemIds.length; i++) {
            const lineId = orderedLineItemIds[i];
            await tx.invoiceLineItem.update({
                where: { id: lineId },
                data: { sortOrder: i },
            });
        }

        // 2. Audit Trail Entry
        await tx.invoiceHistory.create({
            data: {
                invoiceId,
                workspaceId,
                eventType: "LINE_ITEM_UPDATED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "lineItems",
                oldValue: JSON.stringify(invoice.lineItems.map((l) => l.id)),
                newValue: JSON.stringify(orderedLineItemIds),
                metadata: {
                    action: "reorder",
                    orderedLineItemIds,
                },
            },
        });

        // 3. Return refreshed invoice with ordered lines
        return tx.invoice.findFirst({
            where: { id: invoiceId },
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
                payments: true,
            },
        });
    });

    return mapInvoiceToReadModel(updatedInvoice);
}
