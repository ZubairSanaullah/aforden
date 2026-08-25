/**
 * Phase 1.12.9 — Invoice Lifecycle: Void Invoice
 *
 * Locked guard sequence per §6.2.B:
 * 1. RBAC Guard: Assert invoices.void
 * 2. Existence Guard: Invoice findFirst (tenant-scoped) — InvoiceNotFoundError if missing
 * 3. Void Reason Guard: reason non-empty — MissingVoidReasonError
 * 4. Already Voided Guard: status === VOID → InvoiceAlreadyVoidedError
 * 5. Active Payments Guard: any RECORDED payments → InvoiceHasActivePaymentsError
 * 6. Status Eligibility Guard: status must be ISSUED, OVERDUE, or PARTIALLY_PAID (all voidable per §6.1)
 * 7. Persistence: Atomically update status=VOID, voidedAt, voidReason, amountDue=0.00 + InvoiceHistory
 *
 * Voidable statuses per §6.1 state transition matrix:
 * - ISSUED → VOID (line 626)
 * - OVERDUE → VOID (line 631)
 * - PARTIALLY_PAID → VOID: implied by the payment guard (all RECORDED payments must be voided first),
 *   not listed as an explicit edge in the matrix but not prohibited; payment guard is the operative guard.
 * - DRAFT and PAID: not listed as void origins in the matrix, so both are rejected here.
 *
 * Note — amountDue = 0.00 at void:
 * §6.2.B step 6 explicitly sets amountDue = 0.00 on void. Financial amounts are zeroed
 * because a voided invoice has no outstanding balance, but line items and subtotal/total
 * remain untouched as a historical financial record.
 *
 * Note — voidedBy field:
 * The Invoice schema has no voidedByMemberId column (only Payment does). Actor is captured
 * in InvoiceHistory.actorMemberId — the correct audit trail location for invoice-level events.
 *
 * Auth step — disambiguation:
 * If `actor` is passed (tests, internal service calls), it is used directly. If `actor` is
 * absent, `requireWorkspaceAuthorization(workspaceId)` is called to resolve a session actor.
 * There is no "or" — it is injection-first with fallback-to-session. Identical pattern to
 * `issueInvoice`, `createInvoice`, and all other 1.12 services.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
    InvoiceAlreadyVoidedError,
    MissingVoidReasonError,
    InvoiceHasActivePaymentsError,
} from "./invoiceErrors";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { InvoiceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Statuses from which an invoice CAN be voided per the §6.1 state transition matrix.
 * DRAFT and PAID are excluded (DRAFT invoices should be deleted; PAID requires voiding
 * payments first which transitions the invoice away from PAID before voiding is possible).
 */
const VOIDABLE_STATUSES = new Set(["ISSUED", "OVERDUE", "PARTIALLY_PAID"]);

/**
 * Voids an invoice by transitioning it to VOID status.
 * Sets amountDue = 0.00 (locked per §6.2.B step 6).
 * Does NOT cascade-void associated payment records — that is 1.12.10 scope.
 * Line items and stored totals remain byte-for-byte identical as a historical financial record.
 */
export async function voidInvoice(
    workspaceId: string,
    invoiceId: string,
    reason: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceReadModel> {
    // 1. AUTHENTICATION — injection-first, fallback-to-session (identical pattern to all 1.12 services)
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: invoices.void — ForbiddenError before any DB read for unpermissioned roles
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_VOID);

    // 3. Void Reason Guard — before DB read (no point querying if reason is invalid)
    if (!reason || reason.trim().length === 0) {
        throw new MissingVoidReasonError();
    }

    // 4. RESOLUTION — tenant-scoped fetch including payments for the active-payments guard
    const invoice = await prisma.invoice.findFirst({
        where: {
            id: invoiceId,
            workspaceId,
        },
        include: {
            lineItems: { orderBy: { sortOrder: "asc" } },
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

    // Already Voided Guard (§6.2.B step 4) — distinct from the general status conflict
    if (invoice.status === "VOID") {
        throw new InvoiceAlreadyVoidedError();
    }

    // Status Eligibility Guard — DRAFT and PAID are not voidable origins per §6.1 matrix
    if (!VOIDABLE_STATUSES.has(invoice.status)) {
        throw new InvoiceStatusConflictError(
            `Invoice is in ${invoice.status} status and cannot be voided. Only ISSUED, OVERDUE, or PARTIALLY_PAID invoices can be voided.`,
        );
    }

    // Active Payments Guard (§6.2.B step 5) — any non-VOIDED payment blocks voiding
    const activePayments = invoice.payments.filter((p) => p.status !== "VOIDED");
    if (activePayments.length > 0) {
        throw new InvoiceHasActivePaymentsError(
            `Cannot void this invoice: it has ${activePayments.length} active payment(s). Void all associated payments first (Phase 1.12.10).`,
        );
    }

    const voidedAt = new Date();

    // PERSISTENCE — atomic: status, voidedAt, voidReason, amountDue=0.00 + InvoiceHistory
    // §6.2.B step 6: amountDue set to 0.00 on void. Line items and total/subtotal left intact.
    const updatedInvoice = await prisma.$transaction(async (tx) => {
        const updated = await tx.invoice.update({
            where: { id: invoiceId },
            data: {
                status: "VOID",
                voidedAt,
                voidReason: reason.trim(),
                amountDue: new Prisma.Decimal("0.00"),
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
                eventType: "VOIDED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: invoice.status,
                newValue: "VOID",
                metadata: {
                    voidedAt: voidedAt.toISOString(),
                    voidReason: reason.trim(),
                    invoiceNumber: invoice.invoiceNumber,
                    snapshotTotal: invoice.total.toFixed(2),
                },
            },
        });

        return updated;
    });

    return mapInvoiceToReadModel(updatedInvoice);
}
