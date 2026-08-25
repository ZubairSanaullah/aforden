/**
 * Phase 1.11.7 — Revise Quote Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    QuoteNotFoundError,
    QuoteStatusConflictError,
} from "./quoteErrors";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Transitions a Quote from PENDING_APPROVAL back to DRAFT for modifications.
 * Clears sentAt and records an audit history entry.
 */
export async function reviseQuote(
    workspaceId: string,
    quoteId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.update (revision is an editing action)
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_UPDATE);

    // 3. RESOLUTION & INVARIANTS
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
        },
    });

    if (!quote) {
        throw new QuoteNotFoundError();
    }

    // Lifecycle Guard: Only PENDING_APPROVAL quotes can be revised back to DRAFT
    if (quote.status !== "PENDING_APPROVAL") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be revised. Only PENDING_APPROVAL quotes can be returned to DRAFT.`,
        );
    }

    // 4. BUSINESS LOGIC & 5. PERSISTENCE (Atomic Transaction)
    const updatedQuote = await prisma.$transaction(async (tx) => {
        const resultQuote = await tx.quote.update({
            where: { id: quoteId },
            data: {
                status: "DRAFT",
                sentAt: null,
            },
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
            },
        });

        await tx.quoteHistory.create({
            data: {
                quoteId,
                workspaceId,
                eventType: "UPDATED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: "PENDING_APPROVAL",
                newValue: "DRAFT",
                metadata: {
                    action: "REVISED",
                    previousSentAt: quote.sentAt ? quote.sentAt.toISOString() : null,
                },
            },
        });

        return resultQuote;
    });

    return mapQuoteToReadModel(updatedQuote);
}
