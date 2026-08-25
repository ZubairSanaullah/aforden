/**
 * Phase 1.11.9 — Get Quote Timeline Summary Service
 * Derives key milestone timestamps and lifecycle progress directly from the Quote record in O(1) time.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { QuoteNotFoundError } from "./quoteErrors";
import type { QuoteTimelineSummary } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Derives key milestone timestamps directly from the Quote row without scanning history logs.
 * Used for fast timeline rendering in list and dashboard views.
 */
export async function getQuoteTimelineSummary(
    workspaceId: string,
    quoteId: string,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteTimelineSummary> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.view
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_VIEW);

    // 3. RESOLUTION: Tenant-scoped Quote lookup
    const quote = await prisma.quote.findFirst({
        where: {
            id: quoteId,
            workspaceId,
        },
    });

    if (!quote) {
        throw new QuoteNotFoundError();
    }

    // 4. MILESTONE & STATUS DERIVATION
    const now = new Date();
    const validUntilDate = quote.validUntil ? new Date(quote.validUntil) : null;
    const isExpired =
        quote.status === "EXPIRED" ||
        (validUntilDate !== null && validUntilDate < now && quote.status === "PENDING_APPROVAL");
    const isTerminal = ["APPROVED", "REJECTED", "CONVERTED", "EXPIRED"].includes(quote.status);

    let currentLifecycleMilestone:
        | "DRAFT"
        | "SENT"
        | "APPROVED"
        | "REJECTED"
        | "CONVERTED"
        | "EXPIRED" = "DRAFT";

    if (quote.status === "CONVERTED") {
        currentLifecycleMilestone = "CONVERTED";
    } else if (quote.status === "APPROVED") {
        currentLifecycleMilestone = "APPROVED";
    } else if (quote.status === "REJECTED") {
        currentLifecycleMilestone = "REJECTED";
    } else if (quote.status === "EXPIRED") {
        currentLifecycleMilestone = "EXPIRED";
    } else if (quote.status === "PENDING_APPROVAL") {
        currentLifecycleMilestone = "SENT";
    }

    return {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        status: quote.status,
        createdAt: quote.createdAt.toISOString(),
        sentAt: quote.sentAt ? quote.sentAt.toISOString() : null,
        approvedAt: quote.approvedAt ? quote.approvedAt.toISOString() : null,
        approvedByCustomerName: quote.approvedByCustomerName ?? null,
        rejectedAt: quote.rejectedAt ? quote.rejectedAt.toISOString() : null,
        rejectionReason: quote.rejectionReason ?? null,
        convertedAt: quote.convertedAt ? quote.convertedAt.toISOString() : null,
        convertedWorkOrderId: quote.convertedWorkOrderId ?? null,
        validUntil: validUntilDate ? validUntilDate.toISOString() : null,
        isExpired,
        isTerminal,
        currentLifecycleMilestone,
    };
}
