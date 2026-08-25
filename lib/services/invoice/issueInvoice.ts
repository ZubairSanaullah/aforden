/**
 * Phase 1.12.9 — Invoice Lifecycle: Issue Invoice
 * Transition: DRAFT → ISSUED (and no other transition is valid here,
 * except ISSUED → ISSUED which is an idempotent no-op per §6.2.A step 3 of the locked architecture)
 * Locked execution order: AUTH → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 *
 * Locked guard sequence per §6.2.A:
 * 1. RBAC Guard: Assert invoices.issue
 * 2. Existence Guard: Invoice findFirst (tenant-scoped) — InvoiceNotFoundError if missing
 * 3. Status Guard: ISSUED → return idempotent success; non-DRAFT (other than ISSUED) → InvoiceStatusConflictError
 * 4. Line Item Count Guard: 0 line items → InvoiceEmptyLineItemsError
 * 5. Due Date Guard: dueDate < issueDate → InvoiceDueDateInvalidError
 * 6. Customer Activeness Guard (extension): customer must still be ACTIVE in workspace
 * 7. Persistence: Atomically update status=ISSUED, issuedAt=now, amountDue=total, amountPaid=0.00, write InvoiceHistory
 *
 * NOTE — No totals-divergence recomputation guard:
 * The locked §6.2.A spec does not include a recomputation check at issuance time.
 * If that guard is desired in future it requires an explicit architecture decision,
 * since it introduces InvoiceTotalsMismatchError (proposed in this phase but NOT
 * exercised here). The guard has been removed to stay within the locked spec.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
    InvoiceEmptyLineItemsError,
    InvoiceDueDateInvalidError,
} from "./invoiceErrors";
import { CustomerNotFoundError } from "@/lib/services/customer/customerErrors";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Issues an invoice, transitioning it from DRAFT → ISSUED.
 * - If invoice is already ISSUED, returns the current state idempotently (§6.2.A step 3).
 * - Sets issuedAt to the current UTC timestamp.
 * - Atomically resets amountPaid = 0.00, amountDue = invoice.total (§6.2.A step 6).
 * - Writes an InvoiceHistory entry with eventType ISSUED.
 */
export async function issueInvoice(
    workspaceId: string,
    invoiceId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION — actor injected (tests) or resolved from session (production)
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: invoices.issue — ForbiddenError before any DB read for unpermissioned roles
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_ISSUE);

    // 3+4. RESOLUTION — single tenant-scoped query with all required relations
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
            customer: true,
            location: true,
            quote: true,
            workOrder: true,
        },
    });

    if (!invoice) {
        throw new InvoiceNotFoundError();
    }

    // Status guard (§6.2.A step 3):
    // - ISSUED → idempotent success (return current state without side effects)
    // - non-DRAFT (other than ISSUED) → InvoiceStatusConflictError
    if (invoice.status === "ISSUED") {
        return mapInvoiceToReadModel(invoice);
    }

    if (invoice.status !== "DRAFT") {
        throw new InvoiceStatusConflictError(
            `Invoice is in ${invoice.status} status and cannot be issued. Only DRAFT invoices can be issued.`,
        );
    }

    // Line item count guard (§6.2.A step 4)
    if (!invoice.lineItems || invoice.lineItems.length === 0) {
        throw new InvoiceEmptyLineItemsError();
    }

    // Due date guard (§6.2.A step 5)
    if (invoice.dueDate < invoice.issueDate) {
        throw new InvoiceDueDateInvalidError();
    }

    // Customer activeness guard — Customer has a CustomerStatus enum (ACTIVE | INACTIVE) per schema.
    // "Active customer" means status === ACTIVE, not merely exists in the workspace.
    const customer = await prisma.customer.findFirst({
        where: {
            id: invoice.customerId,
            workspaceId,
            status: "ACTIVE",
        },
    });
    if (!customer) {
        throw new CustomerNotFoundError(
            "The customer referenced by this invoice is inactive or no longer exists in this workspace.",
        );
    }

    const issuedAt = new Date();

    // PERSISTENCE — atomic: status update + issuedAt + amountPaid/amountDue reset + InvoiceHistory
    // §6.2.A step 6: amountDue = total, amountPaid = 0.00 are set explicitly at issuance.
    const updatedInvoice = await prisma.$transaction(async (tx) => {
        const updated = await tx.invoice.update({
            where: { id: invoiceId },
            data: {
                status: "ISSUED",
                issuedAt,
                amountDue: invoice.total,
                amountPaid: "0.00",
            },
            include: {
                customer: true,
                location: true,
                quote: true,
                workOrder: true,
                lineItems: { orderBy: { sortOrder: "asc" } },
                payments: true,
            },
        });

        await tx.invoiceHistory.create({
            data: {
                invoiceId,
                workspaceId,
                eventType: "ISSUED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: "DRAFT",
                newValue: "ISSUED",
                metadata: {
                    issuedAt: issuedAt.toISOString(),
                    invoiceNumber: invoice.invoiceNumber,
                    total: invoice.total.toFixed(2),
                    lineItemCount: invoice.lineItems.length,
                },
            },
        });

        // Phase 1.13.9: Emit INVOICE_SENT in same transaction
        await emitNotificationEvent(tx, {
            workspaceId,
            eventType: NotificationEventType.INVOICE_SENT,
            sourceEntity: "Invoice",
            sourceId: updated?.id || invoiceId,
            actorMemberId: authContext.membership.id,
            payload: {
                invoiceId: updated?.id || invoiceId,
                invoiceNumber: updated?.invoiceNumber || invoice.invoiceNumber || "INV-UNKNOWN",
                title: updated?.title || invoice.title || "Invoice",
                customerId: updated?.customerId || invoice.customerId || "customer_unknown",
                customerName: updated?.customer?.name || invoice.customer?.name,
                customerEmail: customer.email ?? undefined,
                totalAmount:
                    typeof updated?.total === "object" && (updated.total as any)?.toFixed
                        ? (updated.total as any).toFixed(2)
                        : String(updated?.total ?? invoice.total ?? "0.00"),
                dueDate:
                    updated?.dueDate instanceof Date
                        ? updated.dueDate.toISOString()
                        : updated?.dueDate
                          ? new Date(updated.dueDate).toISOString()
                          : invoice.dueDate instanceof Date
                            ? invoice.dueDate.toISOString()
                            : new Date().toISOString(),
                currencyCode: updated?.currencyCode || invoice.currencyCode || "USD",
            },
        });

        return updated;
    });

    return mapInvoiceToReadModel(updatedInvoice);
}
