/**
 * Phase 1.12.10 — Payment Services: Record Payment
 *
 * Locked execution order per §5.5:
 * 1. Authentication & RBAC Guard: payments.create
 * 2. Existence & Tenant Isolation Guard: Invoice findFirst (workspace-scoped) -> InvoiceNotFoundError (404)
 * 3. Payload Syntactic & Amount Validation Guard: amount > 0, max 2 decimals -> InvalidPaymentAmountError (422)
 * 4. Terminal & Non-Payable Status Guards (Strict Hierarchical Order):
 *    - 4a (VOID Check): status === VOID -> InvoiceAlreadyVoidedError (409)
 *    - 4b (DRAFT Check): status === DRAFT -> InvoiceStatusConflictError (409)
 *    - 4c (PAID Check): status === PAID -> InvoiceAlreadyPaidError (409)
 * 5. Payable State Affirmation: status in [ISSUED, PARTIALLY_PAID, OVERDUE]
 * 6. Balance & Overpayment Guard: Ledger-recalculated amountPaid + amount > total -> OverpaymentNotAllowedError (422)
 * 7. Atomic Execution & State Transition (inside Prisma $transaction):
 *    - Generate paymentNumber (PAY-YYYY-XXXXXX)
 *    - Create Payment row (status: RECORDED)
 *    - Update Invoice (amountPaid, amountDue, status: PAID if amountDue == 0 else PARTIALLY_PAID, paidAt)
 *    - Create InvoiceHistory (eventType: PAYMENT_APPLIED)
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
    InvoiceAlreadyVoidedError,
    InvoiceAlreadyPaidError,
    OverpaymentNotAllowedError,
    InvalidPaymentAmountError,
} from "./invoiceErrors";
import { recordPaymentSchema } from "./invoice.schemas";
import { mapPaymentToReadModel } from "./invoiceMappers";
import type { PaymentReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";
import {
    emitNotificationEvent,
    NotificationEventType,
} from "@/lib/services/notification";

/**
 * Records a customer payment against an invoice within an authorized workspace.
 * Reconciles invoice running balances from the payment ledger and updates invoice status.
 */
export async function recordPayment(
    workspaceId: string,
    invoiceId: string,
    payload: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<PaymentReadModel> {
    // 1. Authentication & RBAC Guard
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));
    assertPermission(authContext.membership.role, PERMISSIONS.PAYMENTS_CREATE);

    // 3. Payload Syntactic & Amount Validation Guard
    const parseResult = recordPaymentSchema.safeParse(payload);
    if (!parseResult.success) {
        const amountIssue = parseResult.error.issues.find((i) => i.path.includes("amount"));
        if (amountIssue) {
            throw new InvalidPaymentAmountError(amountIssue.message);
        }
        throw parseResult.error;
    }
    const data = parseResult.data;

    // Convert amount to exact Decimal
    const paymentAmount = new Prisma.Decimal(data.amount.toFixed(2));
    if (paymentAmount.lessThanOrEqualTo(new Prisma.Decimal("0.00"))) {
        throw new InvalidPaymentAmountError("Payment amount must be greater than zero.");
    }

    // 2. Existence & Tenant Isolation Guard + Resolution of existing payments ledger
    const invoice = await prisma.invoice.findFirst({
        where: {
            id: invoiceId,
            workspaceId,
        },
        include: {
            payments: true,
        },
    });

    if (!invoice) {
        throw new InvoiceNotFoundError();
    }

    // 4. Terminal & Non-Payable Status Guards (Strict Hierarchical Order per §5.5 Step 4)
    // Step 4a: VOID Check
    if (invoice.status === "VOID") {
        throw new InvoiceAlreadyVoidedError();
    }

    // Step 4b: DRAFT Check
    if (invoice.status === "DRAFT") {
        throw new InvoiceStatusConflictError(
            "Cannot apply payment to a DRAFT invoice; invoice must be in ISSUED, PARTIALLY_PAID, or OVERDUE status",
        );
    }

    // Step 4c: PAID Check
    if (invoice.status === "PAID") {
        throw new InvoiceAlreadyPaidError();
    }

    // 5. Payable State Affirmation
    const payableStatuses = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];
    if (!payableStatuses.includes(invoice.status)) {
        throw new InvoiceStatusConflictError(
            `Invoice is in ${invoice.status} status and cannot receive payments.`,
        );
    }

    // 6. Balance & Overpayment Guard (recomputed strictly from payment ledger, not trusting cached amountPaid)
    const activePayments = invoice.payments.filter((p) => p.status === "RECORDED");
    const currentAmountPaid = activePayments.reduce(
        (sum, p) => sum.plus(p.amount),
        new Prisma.Decimal("0.00"),
    );
    const currentAmountDue = invoice.total.minus(currentAmountPaid);

    if (paymentAmount.greaterThan(currentAmountDue)) {
        throw new OverpaymentNotAllowedError("Payment amount exceeds outstanding balance due.");
    }

    // Business Logic: calculate new balances and new status
    const newAmountPaid = currentAmountPaid.plus(paymentAmount);
    const newAmountDue = invoice.total.minus(newAmountPaid);
    const isFullyPaid = newAmountDue.equals(new Prisma.Decimal("0.00"));
    const newStatus = isFullyPaid ? "PAID" : "PARTIALLY_PAID";
    const now = new Date();
    const paymentDate = data.paymentDate ? new Date(data.paymentDate) : now;

    // 7. Atomic Execution & State Transition (inside Prisma $transaction with Concurrency Retry)
    const year = paymentDate.getFullYear();
    const prefix = `PAY-${year}-`;
    const MAX_NUMBER_RETRIES = 5;

    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
        try {
            const result = await prisma.$transaction(async (tx) => {
                // Sequential paymentNumber generation (PAY-YYYY-XXXXXX)
                const latest = await tx.payment.findFirst({
                    where: {
                        workspaceId,
                        paymentNumber: { startsWith: prefix },
                    },
                    orderBy: { paymentNumber: "desc" },
                    select: { paymentNumber: true },
                });

                let nextSeq = 1;
                if (latest?.paymentNumber) {
                    const match = latest.paymentNumber.match(/^PAY-(?:\d{4}-)?(\d+)$/);
                    if (match && match[1]) {
                        const currentSeq = parseInt(match[1], 10);
                        if (!isNaN(currentSeq)) {
                            nextSeq = currentSeq + 1;
                        }
                    }
                }

                const paymentNumber = `${prefix}${String(nextSeq).padStart(6, "0")}`;

                // Create Payment record
                const payment = await tx.payment.create({
                    data: {
                        workspaceId,
                        invoiceId,
                        paymentNumber,
                        customerId: invoice.customerId,
                        amount: paymentAmount,
                        currencyCode: invoice.currencyCode,
                        paymentMethod: data.paymentMethod,
                        referenceNumber: data.referenceNumber ?? null,
                        status: "RECORDED",
                        paymentDate,
                        notes: data.notes ?? null,
                        recordedByMemberId: authContext.membership.id,
                    },
                    include: {
                        recordedByMember: {
                            include: {
                                user: {
                                    select: {
                                        id: true,
                                        name: true,
                                        email: true,
                                        avatarUrl: true,
                                    },
                                },
                            },
                        },
                        voidedByMember: {
                            include: {
                                user: {
                                    select: {
                                        id: true,
                                        name: true,
                                        email: true,
                                        avatarUrl: true,
                                    },
                                },
                            },
                        },
                    },
                });

                // Update Invoice balances and status
                await tx.invoice.update({
                    where: { id: invoiceId },
                    data: {
                        amountPaid: newAmountPaid,
                        amountDue: newAmountDue,
                        status: newStatus,
                        paidAt: isFullyPaid ? now : null,
                    },
                });

                // Record InvoiceHistory audit record
                await tx.invoiceHistory.create({
                    data: {
                        invoiceId,
                        workspaceId,
                        eventType: "PAYMENT_APPLIED",
                        actorMemberId: authContext.membership.id,
                        actorName: authContext.user?.name ?? null,
                        field: "amountPaid",
                        oldValue: currentAmountPaid.toFixed(2),
                        newValue: newAmountPaid.toFixed(2),
                        metadata: {
                            paymentId: payment.id,
                            paymentNumber: payment.paymentNumber,
                            amount: paymentAmount.toFixed(2),
                            amountDue: newAmountDue.toFixed(2),
                            status: newStatus,
                            previousStatus: invoice.status,
                        },
                    },
                });

                // Phase 1.13.9: Emit PAYMENT_RECEIVED in same transaction
                await emitNotificationEvent(tx, {
                    workspaceId,
                    eventType: NotificationEventType.PAYMENT_RECEIVED,
                    sourceEntity: "Payment",
                    sourceId: payment.id,
                    actorMemberId: authContext.membership.id,
                    payload: {
                        paymentId: payment.id,
                        paymentNumber: payment.paymentNumber || "PAY-UNKNOWN",
                        invoiceId: invoice.id,
                        invoiceNumber: invoice.invoiceNumber || "INV-UNKNOWN",
                        customerId: invoice.customerId || (payment as any).customerId || "customer_unknown",
                        customerName: (invoice as any).customer?.name,
                        amount: paymentAmount.toFixed(2),
                        currencyCode: invoice.currencyCode || payment.currencyCode || "USD",
                        paymentMethod: payment.paymentMethod || data.paymentMethod || "MANUAL",
                        paymentDate: (paymentDate instanceof Date ? paymentDate.toISOString() : new Date(paymentDate).toISOString()),
                        remainingInvoiceBalance: newAmountDue.toFixed(2),
                    },
                });

                return payment;
            });

            return mapPaymentToReadModel(result);
        } catch (err: any) {
            lastError = err;
            const isUniqueConstraint =
                err?.code === "P2002" ||
                err?.message?.includes("Unique constraint") ||
                (err?.meta?.target && Array.isArray(err.meta.target) && err.meta.target.includes("paymentNumber"));

            if (isUniqueConstraint && attempt < MAX_NUMBER_RETRIES - 1) {
                continue; // Retry with fresh latest paymentNumber sequence lookup
            }
            throw err;
        }
    }

    throw lastError;
}
