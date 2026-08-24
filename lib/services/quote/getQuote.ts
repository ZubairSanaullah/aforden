/**
 * Phase 1.11.5 — Quote Retrieval Service
 * Implements tenant-scoped quote lookup with full line item and history relationships.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { QuoteNotFoundError } from "./quoteErrors";
import { mapQuoteToReadModel, mapQuoteHistoryToReadModel } from "./quoteMappers";
import type { QuoteReadModel, QuoteHistoryReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

export interface QuoteDetailReadModel extends QuoteReadModel {
    history?: QuoteHistoryReadModel[];
}

/**
 * Retrieves a single Quote by ID within the authorized workspace.
 */
export async function getQuote(
    workspaceId: string,
    quoteId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteDetailReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.view
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_VIEW);

    // 3. RESOLUTION & TENANT LOOKUP
    const quote = await prisma.quote.findFirst({
        where: {
            id: quoteId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            lineItems: {
                orderBy: { sortOrder: "asc" },
            },
            history: {
                orderBy: { createdAt: "desc" },
            },
        },
    });

    if (!quote) {
        throw new QuoteNotFoundError();
    }

    const readModel = mapQuoteToReadModel(quote) as QuoteDetailReadModel;
    if (quote.history) {
        readModel.history = quote.history.map(mapQuoteHistoryToReadModel);
    }

    return readModel;
}
