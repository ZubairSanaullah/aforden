/**
 * Phase 1.12.7 — Get Invoice Payments Service
 * Retrieves all payments for a specific invoice in an authorized workspace.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { InvoiceNotFoundError } from "./invoiceErrors";
import { mapPaymentToReadModel } from "./invoiceMappers";
import type { PaymentReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Retrieves all payment records associated with a specific invoice.
 * Tenant-scoped and ordered by paymentDate desc with deterministic tie-breaker.
 */
export async function getInvoicePayments(
    workspaceId: string,
    invoiceId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<PaymentReadModel[]> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert payments.view
    assertPermission(authContext.membership.role, PERMISSIONS.PAYMENTS_VIEW);

    // 3. RESOLUTION & INVARIANTS: Verify invoice exists in workspace
    const invoice = await prisma.invoice.findFirst({
        where: {
            id: invoiceId,
            workspaceId,
        },
    });

    if (!invoice) {
        throw new InvoiceNotFoundError();
    }

    // 4. QUERY PAYMENTS
    const payments = await prisma.payment.findMany({
        where: {
            invoiceId,
            workspaceId,
        },
        orderBy: [
            { paymentDate: "desc" },
            { id: "asc" },
        ],
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

    return payments.map(mapPaymentToReadModel);
}
