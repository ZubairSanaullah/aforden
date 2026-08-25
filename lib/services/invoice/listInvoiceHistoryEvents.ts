/**
 * Phase 1.12.12 — List Invoice History Events Service
 * Multi-invoice operational audit trail query across the workspace with filtering and pagination.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { listInvoiceHistoryEventsQuerySchema } from "./invoice.schemas";
import { mapInvoiceHistoryToReadModel } from "./invoiceMappers";
import type {
    PaginatedInvoiceHistoryReadModel,
    InvoiceHistoryEventType,
} from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves a paginated list of operational history events across the workspace.
 * Supports filtering by invoiceId, eventType, actorMemberId, and date range.
 */
export async function listInvoiceHistoryEvents(
    workspaceId: string,
    filters?: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<PaginatedInvoiceHistoryReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.view
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_VIEW);

    // 3. VALIDATION
    const query = listInvoiceHistoryEventsQuerySchema.parse(filters ?? {});

    // 4. QUERY CONSTRUCTION
    const where: Prisma.InvoiceHistoryWhereInput = {
        workspaceId,
    };

    if (query.invoiceId) {
        where.invoiceId = query.invoiceId;
    }

    if (query.eventType) {
        if (Array.isArray(query.eventType)) {
            where.eventType = { in: query.eventType as InvoiceHistoryEventType[] };
        } else {
            where.eventType = query.eventType as InvoiceHistoryEventType;
        }
    }

    if (query.actorMemberId) {
        where.actorMemberId = query.actorMemberId;
    }

    // Date range filters
    const fromDate = query.fromDate || query.createdFrom;
    const toDate = query.toDate || query.createdTo;

    if (fromDate || toDate) {
        where.createdAt = {};
        if (fromDate) {
            where.createdAt.gte = new Date(fromDate);
        }
        if (toDate) {
            where.createdAt.lte = new Date(toDate);
        }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder ?? "desc";

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
