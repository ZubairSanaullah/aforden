/**
 * Phase 1.11.5 — Quote Deletion Service
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
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

export interface DeleteQuoteResult {
    success: boolean;
    id: string;
}

/**
 * Deletes a Quote in DRAFT status within an authorized workspace.
 * Deletion is strictly forbidden for any non-DRAFT status.
 */
export async function deleteQuote(
    workspaceId: string,
    quoteId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<DeleteQuoteResult> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.delete
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_DELETE);

    // 3. RESOLUTION & INVARIANTS
    const existing = await prisma.quote.findFirst({
        where: {
            id: quoteId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new QuoteNotFoundError();
    }

    // Lifecycle Guard: Only DRAFT quotes can be deleted
    if (existing.status !== "DRAFT") {
        throw new QuoteStatusConflictError(
            `Quotes in ${existing.status} status cannot be deleted. Only DRAFT quotes can be deleted.`,
        );
    }

    // 4. PERSISTENCE (Atomic Transaction)
    await prisma.$transaction(async (tx) => {
        // Write audit history record before deleting quote
        await tx.quoteHistory.create({
            data: {
                quoteId: existing.id,
                workspaceId,
                eventType: "DELETED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: existing.status,
                newValue: "DELETED",
                metadata: {
                    quoteNumber: existing.quoteNumber,
                    title: existing.title,
                },
            },
        });

        // Delete Quote (cascades to line items and histories per schema)
        await tx.quote.delete({
            where: { id: quoteId },
        });
    });

    return {
        success: true,
        id: quoteId,
    };
}
