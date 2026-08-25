/**
 * Phase 1.12.7 — Customer Outstanding Balance / AR Summary Service
 * Aggregates unpaid balances across non-DRAFT, non-VOID invoices for a customer.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { CustomerNotFoundError } from "@/lib/services/customer/customerErrors";
import type { CustomerOutstandingBalanceReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Calculates the total accounts receivable (AR) outstanding balance for a customer.
 * Aggregates amountDue across all invoices in ISSUED, PARTIALLY_PAID, PAID, and OVERDUE statuses,
 * strictly excluding DRAFT and VOID invoices.
 */
export async function getCustomerOutstandingBalance(
    workspaceId: string,
    customerId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<CustomerOutstandingBalanceReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.view
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_VIEW);

    // 3. RESOLUTION: Verify customer exists in tenant workspace
    const customer = await prisma.customer.findFirst({
        where: {
            id: customerId,
            workspaceId,
        },
        include: {
            workspace: true,
        },
    });

    if (!customer) {
        throw new CustomerNotFoundError();
    }

    // 4. AGGREGATE OUTSTANDING INVOICES
    const invoices = await prisma.invoice.findMany({
        where: {
            workspaceId,
            customerId,
            status: {
                notIn: ["DRAFT", "VOID"],
            },
        },
        select: {
            amountDue: true,
            currencyCode: true,
        },
    });

    let totalBalance = new Prisma.Decimal("0.00");
    for (const inv of invoices) {
        totalBalance = totalBalance.add(inv.amountDue);
    }

    const defaultCurrency =
        customer.workspace?.defaultCurrencyCode ?? invoices[0]?.currencyCode ?? "USD";

    return {
        customerId,
        totalOutstandingBalance: totalBalance.toFixed(2),
        currencyCode: defaultCurrency,
        invoiceCount: invoices.length,
    };
}
