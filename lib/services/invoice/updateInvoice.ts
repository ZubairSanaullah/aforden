/**
 * Phase 1.12.5 — Invoice Header Update Service (Header CRUD)
 * Implements the locked execution pipeline and lifecycle mutability guards:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateInvoiceSchema } from "./invoice.schemas";
import {
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
    InvoiceDueDateInvalidError,
} from "./invoiceErrors";
import { calculateInvoiceTotals } from "./invoiceCalculationEngine";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Updates an Invoice's header fields within an authorized workspace.
 * Strictly restricted to DRAFT status.
 */
export async function updateInvoice(
    workspaceId: string,
    invoiceId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.update
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_UPDATE);

    // 3. VALIDATION
    const data = updateInvoiceSchema.parse(input);

    // 4. RESOLUTION & INVARIANTS
    const existing = await prisma.invoice.findFirst({
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

    if (!existing) {
        throw new InvoiceNotFoundError();
    }

    // Lifecycle Mutability Guard: Only DRAFT status permits edits
    if (existing.status !== "DRAFT") {
        throw new InvoiceStatusConflictError(
            `Invoices in ${existing.status} status cannot be edited. Only DRAFT invoices can be modified.`,
        );
    }

    // Validate dueDate >= issueDate if dueDate or issueDate is being changed
    const effectiveIssueDate = data.issueDate ? new Date(data.issueDate) : existing.issueDate;
    const effectiveDueDate = data.dueDate ? new Date(data.dueDate) : existing.dueDate;
    if (effectiveDueDate.getTime() < effectiveIssueDate.getTime()) {
        throw new InvoiceDueDateInvalidError("Due date cannot be before issue date");
    }

    // 5. BUSINESS LOGIC: Re-calculate totals if discount or tax parameters change
    const discountType = data.discountType !== undefined ? data.discountType : existing.discountType;
    const discountValue = data.discountValue !== undefined ? new Prisma.Decimal(String(data.discountValue)) : existing.discountValue;
    const taxRate = data.taxRate !== undefined ? new Prisma.Decimal(String(data.taxRate)) : existing.taxRate;

    const calculationNeeded =
        data.discountType !== undefined ||
        data.discountValue !== undefined ||
        data.taxRate !== undefined;

    let computedTotals = {
        subtotal: existing.subtotal,
        discountAmount: existing.discountAmount,
        taxAmount: existing.taxAmount,
        total: existing.total,
        amountPaid: existing.amountPaid,
        amountDue: existing.amountDue,
        lineItems: [] as any[],
    };

    if (calculationNeeded && existing.lineItems.length > 0) {
        const computed = calculateInvoiceTotals(
            {
                discountType,
                discountValue,
                taxRate,
            },
            existing.lineItems.map((item) => ({
                id: item.id,
                sortOrder: item.sortOrder,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                unitCost: item.unitCost,
                discountAmount: item.discountAmount,
                taxRate: item.taxRate,
                name: item.name,
            })),
            existing.payments.map((p) => ({
                id: p.id,
                amount: p.amount,
                status: p.status,
            })),
        );

        computedTotals = {
            subtotal: computed.subtotal,
            discountAmount: computed.discountAmount,
            taxAmount: computed.taxAmount,
            total: computed.total,
            amountPaid: computed.amountPaid,
            amountDue: computed.amountDue,
            lineItems: computed.lineItems,
        };
    }

    // 6. PERSISTENCE (Atomic Transaction)
    const runTx = typeof prisma.$transaction === "function"
        ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
        : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const updatedInvoice = await runTx(async (tx) => {
        // If line items were recalculated due to header parameter change, update them
        if (computedTotals.lineItems.length > 0) {
            for (const calculatedLine of computedTotals.lineItems) {
                if (calculatedLine.id) {
                    await tx.invoiceLineItem.update({
                        where: { id: calculatedLine.id },
                        data: {
                            subtotal: calculatedLine.subtotal,
                            discountAmount: calculatedLine.discountAmount,
                            taxAmount: calculatedLine.taxAmount,
                            total: calculatedLine.total,
                        },
                    });
                }
            }
        }

        const updateData: Prisma.InvoiceUpdateInput = {
            ...(data.title !== undefined && { title: data.title }),
            ...(data.notes !== undefined && { notes: data.notes }),
            ...(data.internalNotes !== undefined && { internalNotes: data.internalNotes }),
            ...(data.termsAndConditions !== undefined && { termsAndConditions: data.termsAndConditions }),
            ...(data.issueDate !== undefined && { issueDate: effectiveIssueDate }),
            ...(data.dueDate !== undefined && { dueDate: effectiveDueDate }),
            ...(data.discountType !== undefined && { discountType: data.discountType }),
            ...(data.discountValue !== undefined && { discountValue }),
            ...(data.taxRate !== undefined && { taxRate }),
            ...(calculationNeeded && existing.lineItems.length > 0 && {
                subtotal: computedTotals.subtotal,
                discountAmount: computedTotals.discountAmount,
                taxAmount: computedTotals.taxAmount,
                total: computedTotals.total,
                amountPaid: computedTotals.amountPaid,
                amountDue: computedTotals.amountDue,
            }),
        };

        const result = await tx.invoice.update({
            where: { id: invoiceId },
            data: updateData,
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
                payments: true,
            },
        });

        // Write audit history entry
        await tx.invoiceHistory.create({
            data: {
                invoiceId,
                workspaceId,
                eventType: "UPDATED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "header",
                oldValue: JSON.stringify({
                    title: existing.title,
                    discountType: existing.discountType,
                    discountValue: existing.discountValue.toString(),
                    taxRate: existing.taxRate.toString(),
                    dueDate: existing.dueDate.toISOString(),
                }),
                newValue: JSON.stringify({
                    title: result.title,
                    discountType: result.discountType,
                    discountValue: result.discountValue.toString(),
                    taxRate: result.taxRate.toString(),
                    dueDate: result.dueDate.toISOString(),
                }),
                metadata: {
                    updatedFields: Object.keys(data),
                },
            },
        });

        return result;
    });

    return mapInvoiceToReadModel(updatedInvoice);
}
