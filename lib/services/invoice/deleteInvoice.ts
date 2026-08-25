/**
 * Phase 1.12.5 — Invoice Deletion Service (Header CRUD)
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
} from "./invoiceErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

export interface DeleteInvoiceResult {
    success: boolean;
    id: string;
}

/**
 * Deletes an Invoice in DRAFT status within an authorized workspace.
 * Deletion is strictly forbidden for any non-DRAFT status or if any payments exist.
 */
export async function deleteInvoice(
    workspaceId: string,
    invoiceId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<DeleteInvoiceResult> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.delete
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_DELETE);

    // 3. RESOLUTION & INVARIANTS
    const existing = await prisma.invoice.findFirst({
        where: {
            id: invoiceId,
            workspaceId,
        },
        include: {
            payments: {
                select: { id: true },
            },
        },
    });

    if (!existing) {
        throw new InvoiceNotFoundError();
    }

    // Lifecycle Guard: Only DRAFT invoices can be deleted
    if (existing.status !== "DRAFT") {
        throw new InvoiceStatusConflictError(
            `Invoices in ${existing.status} status cannot be deleted. Only DRAFT invoices can be deleted.`,
        );
    }

    // Defensive Invariant Guard: Zero payments check
    if (existing.payments && existing.payments.length > 0) {
        throw new InvoiceStatusConflictError(
            "Cannot delete invoice with associated payment records.",
        );
    }

    // 4. PERSISTENCE (Atomic Transaction)
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    await runTx(async (tx) => {
        // Write audit history record with DELETED event type before deleting invoice
        await tx.invoiceHistory.create({
            data: {
                invoiceId: existing.id,
                workspaceId,
                eventType: "DELETED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: existing.status,
                newValue: "DELETED",
                metadata: {
                    invoiceNumber: existing.invoiceNumber,
                    title: existing.title,
                },
            },
        });

        // Delete Invoice (cascades to line items and histories per schema onDelete: Cascade)
        await tx.invoice.delete({
            where: { id: invoiceId },
        });
    });

    return {
        success: true,
        id: invoiceId,
    };
}
