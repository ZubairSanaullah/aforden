/**
 * Phase 1.12.5 — Invoice Retrieval Service (Header CRUD)
 * Implements tenant-scoped invoice lookup with full line item, payment, and history relationships.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { InvoiceNotFoundError } from "./invoiceErrors";
import {
    mapInvoiceToReadModel,
    mapInvoiceLineItemToReadModel,
    mapPaymentToReadModel,
    mapInvoiceHistoryToReadModel,
} from "./invoiceMappers";
import type { InvoiceReadModel, InvoiceHistoryReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

export interface InvoiceDetailReadModel extends InvoiceReadModel {
    history?: InvoiceHistoryReadModel[];
}

/**
 * Retrieves a single Invoice by ID within the authorized workspace.
 */
export async function getInvoice(
    workspaceId: string,
    invoiceId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<InvoiceDetailReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.view
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_VIEW);

    // 3. RESOLUTION & TENANT LOOKUP
    const invoice = await prisma.invoice.findFirst({
        where: {
            id: invoiceId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            lineItems: {
                orderBy: { sortOrder: "asc" },
            },
            payments: {
                orderBy: { createdAt: "desc" },
            },
            history: {
                orderBy: { createdAt: "desc" },
            },
        },
    });

    if (!invoice) {
        throw new InvoiceNotFoundError();
    }

    const readModel = mapInvoiceToReadModel(invoice) as InvoiceDetailReadModel;

    if (invoice.lineItems) {
        readModel.lineItems = invoice.lineItems.map(mapInvoiceLineItemToReadModel);
    }
    if (invoice.payments) {
        readModel.payments = invoice.payments.map(mapPaymentToReadModel);
    }
    if (invoice.history) {
        readModel.history = invoice.history.map(mapInvoiceHistoryToReadModel);
    }

    return readModel;
}
