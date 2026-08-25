/**
 * Phase 1.12.12 — Get Invoice History Service
 * Retrieves the paginated operational history and audit timeline for a single Invoice.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { getInvoiceHistoryQuerySchema } from "./invoice.schemas";
import { InvoiceNotFoundError } from "./invoiceErrors";
import { mapInvoiceHistoryToReadModel } from "./invoiceMappers";
import type {
    PaginatedInvoiceHistoryReadModel,
    InvoiceHistoryEventType,
} from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves the full operational history and audit ledger timeline of an Invoice.
 * Supports filtering by eventType and consistent pagination.
 */
export async function getInvoiceHistory(
    workspaceId: string,
    invoiceId: string,
    actor?: WorkspaceAuthorizationContext,
    queryInput?: unknown,
): Promise<PaginatedInvoiceHistoryReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.view
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_VIEW);

    // 3. VALIDATION
    const query = getInvoiceHistoryQuerySchema.parse(queryInput ?? {});

    // 4. RESOLUTION: Check invoice exists in target workspace
    const invoice = await prisma.invoice.findFirst({
        where: {
            id: invoiceId,
            workspaceId,
        },
        select: { id: true },
    });

    if (!invoice) {
        throw new InvoiceNotFoundError();
    }

    // 5. QUERY CONSTRUCTION
    const where: Prisma.InvoiceHistoryWhereInput = {
        workspaceId,
        invoiceId,
    };

    if (query.eventType) {
        if (Array.isArray(query.eventType)) {
            where.eventType = { in: query.eventType as InvoiceHistoryEventType[] };
        } else {
            where.eventType = query.eventType as InvoiceHistoryEventType;
        }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder ?? "asc";

    const [total, records] = await Promise.all([
        prisma.invoiceHistory.count({ where }),
        prisma.invoiceHistory.findMany({
            where,
            skip,
            take: limit,
            orderBy: [
                { createdAt: sortOrder },
                { id: sortOrder },
            ],
        }),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
        items: records.map(mapInvoiceHistoryToReadModel),
        total,
        page,
        limit,
        totalPages,
    };
}
