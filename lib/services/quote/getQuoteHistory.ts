/**
 * Phase 1.11.9 — Get Quote History Service
 * Retrieves the paginated operational history and audit timeline of a Quote.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { quoteHistoryQuerySchema } from "./quote.schemas";
import { QuoteNotFoundError } from "./quoteErrors";
import { mapQuoteHistoryToReadModel } from "./quoteMappers";
import type {
    PaginatedQuoteHistoryReadModel,
    QuoteHistoryEventType,
} from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Retrieves the operational history and audit ledger timeline of a Quote.
 * Supports filtering by eventType and consistent pagination.
 */
export async function getQuoteHistory(
    workspaceId: string,
    quoteId: string,
    actor?: WorkspaceAuthorizationContext,
    queryInput?: unknown,
): Promise<PaginatedQuoteHistoryReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.view
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_VIEW);

    // 3. VALIDATION
    const query = quoteHistoryQuerySchema.parse(queryInput ?? {});

    // 4. RESOLUTION: Check quote exists in target workspace
    const quote = await prisma.quote.findFirst({
        where: {
            id: quoteId,
            workspaceId,
        },
        select: { id: true },
    });

    if (!quote) {
        throw new QuoteNotFoundError();
    }

    // 5. QUERY CONSTRUCTION
    const where: Prisma.QuoteHistoryWhereInput = {
        workspaceId,
        quoteId,
    };

    if (query.eventType) {
        if (Array.isArray(query.eventType)) {
            where.eventType = { in: query.eventType as QuoteHistoryEventType[] };
        } else {
            where.eventType = query.eventType as QuoteHistoryEventType;
        }
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const sortOrder = query.sortOrder ?? "desc";

    const [total, records] = await Promise.all([
        prisma.quoteHistory.count({ where }),
        prisma.quoteHistory.findMany({
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
        items: records.map(mapQuoteHistoryToReadModel),
        total,
        page,
        limit,
        totalPages,
    };
}
