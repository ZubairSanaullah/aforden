/**
 * Phase 1.12.10 — Payment Services: Void Payment
 *
 * Locked execution order per §6.2.C:
 * 1. RBAC Guard: Assert payments.void
 * 2. Existence Guard: Fetch Payment with its Invoice -> PaymentNotFoundError (404)
 * 3. Void Reason Guard: payload.voidReason non-empty string -> MissingVoidReasonError (422)
 * 4. Already Voided Guard: payment.status === VOIDED -> PaymentAlreadyVoidedError (409)
 * 5. Parent Invoice Void Guard: payment.invoice.status === VOID -> InvoiceAlreadyVoidedError (409)
 * 6. Execution (in $transaction):
 *    - Update Payment: status = VOIDED, voidedAt = now(), voidedByMemberId = actor.id, voidReason = reason
 *    - Recalculate remaining active amountPaid = sum(RECORDED payments excluding this one)
 *    - Recalculate amountDue = invoice.total - amountPaid
 *    - Determine new InvoiceStatus:
 *      - amountPaid == 0.00 && now() > invoice.dueDate -> OVERDUE
 *      - amountPaid == 0.00 && now() <= invoice.dueDate -> ISSUED
 *      - amountPaid > 0.00 && now() > invoice.dueDate -> OVERDUE
 *      - amountPaid > 0.00 && now() <= invoice.dueDate -> PARTIALLY_PAID
 *    - Update Invoice: amountPaid, amountDue, status = newStatus, paidAt = null
 *    - Log InvoiceHistory event PAYMENT_VOIDED
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    PaymentNotFoundError,
    PaymentAlreadyVoidedError,
    MissingVoidReasonError,
    InvoiceAlreadyVoidedError,
} from "./invoiceErrors";
import { mapPaymentToReadModel } from "./invoiceMappers";
import type { PaymentReadModel, InvoiceStatus } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Voids a recorded payment transaction.
 * Automatically recalculates parent invoice running balances and reverts invoice status per §6.2.C.
 */
export async function voidPayment(
    workspaceId: string,
    paymentId: string,
    reason: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<PaymentReadModel> {
    // 1. RBAC Guard
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));
    assertPermission(authContext.membership.role, PERMISSIONS.PAYMENTS_VOID);

    // 3. Void Reason Guard (before DB read)
    if (!reason || reason.trim().length === 0) {
        throw new MissingVoidReasonError();
    }

    // 2. Existence Guard: Fetch Payment with its parent Invoice and payments ledger
    const payment = await prisma.payment.findFirst({
        where: {
            id: paymentId,
            workspaceId,
        },
        include: {
            invoice: {
                include: {
                    payments: true,
                },
            },
            recordedByMember: {
                include: {
                    user: true,
                },
            },
            voidedByMember: {
                include: {
                    user: true,
                },
            },
        },
    });

    if (!payment) {
        throw new PaymentNotFoundError();
    }

    // 4. Already Voided Guard
    if (payment.status === "VOIDED") {
        throw new PaymentAlreadyVoidedError();
    }

    // 5. Parent Invoice Status Guard: payments on an already VOID invoice cannot be modified
    if (payment.invoice.status === "VOID") {
        throw new InvoiceAlreadyVoidedError(
            "Cannot void payment on an invoice that is already voided.",
        );
    }

    // Business Logic: recalculate remaining active payment ledger and parent invoice status
    const remainingActivePayments = payment.invoice.payments.filter(
        (p) => p.id !== paymentId && p.status === "RECORDED",
    );

    const newAmountPaid = remainingActivePayments.reduce(
        (sum, p) => sum.plus(p.amount),
        new Prisma.Decimal("0.00"),
    );
    const newAmountDue = payment.invoice.total.minus(newAmountPaid);

    const now = new Date();
    const isPastDue = now > payment.invoice.dueDate;

    let newInvoiceStatus: InvoiceStatus;
    if (newAmountPaid.equals(new Prisma.Decimal("0.00"))) {
        newInvoiceStatus = isPastDue ? "OVERDUE" : "ISSUED";
    } else {
        newInvoiceStatus = isPastDue ? "OVERDUE" : "PARTIALLY_PAID";
    }

    // 6. Atomic Execution (in $transaction)
    const result = await prisma.$transaction(async (tx) => {
        // Update Payment record
        const updatedPayment = await tx.payment.update({
            where: { id: paymentId },
            data: {
                status: "VOIDED",
                voidedAt: now,
                voidedByMemberId: authContext.membership.id,
                voidReason: reason.trim(),
            },
            include: {
                recordedByMember: {
                    include: {
                        user: true,
                    },
                },
                voidedByMember: {
                    include: {
                        user: true,
                    },
                },
            },
        });

        // Update parent Invoice
        await tx.invoice.update({
            where: { id: payment.invoiceId },
            data: {
                amountPaid: newAmountPaid,
                amountDue: newAmountDue,
                status: newInvoiceStatus,
                paidAt: null,
            },
        });

        // Create InvoiceHistory entry
        await tx.invoiceHistory.create({
            data: {
                invoiceId: payment.invoiceId,
                workspaceId,
                eventType: "PAYMENT_VOIDED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "amountPaid",
                oldValue: payment.invoice.amountPaid.toFixed(2),
                newValue: newAmountPaid.toFixed(2),
                metadata: {
                    paymentId: payment.id,
                    paymentNumber: payment.paymentNumber,
                    voidReason: reason.trim(),
                    amountDue: newAmountDue.toFixed(2),
                    status: newInvoiceStatus,
                    previousStatus: payment.invoice.status,
                },
            },
        });

        return updatedPayment;
    });

    return mapPaymentToReadModel(result);
}
