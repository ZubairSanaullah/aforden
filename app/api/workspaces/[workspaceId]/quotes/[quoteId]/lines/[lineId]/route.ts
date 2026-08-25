import { NextResponse } from "next/server";
import {
    updateQuoteLineItem,
    removeQuoteLineItem,
} from "@/lib/services/quote";
import {
    resolveWorkspaceId,
    handleQuoteApiError,
} from "@/lib/utils/quoteApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        quoteId: string;
        lineId: string;
    }>;
}

/**
 * PATCH /api/workspaces/[workspaceId]/quotes/[quoteId]/lines/[lineId]
 * Updates a line item on a DRAFT quote and recalculates totals.
 */
export async function PATCH(request: Request, context: RouteContext) {
    try {
        const {
            workspaceId: pathWorkspaceId,
            quoteId,
            lineId,
        } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const quote = await updateQuoteLineItem(
            workspaceId,
            quoteId,
            lineId,
            body,
        );

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(
            error,
            "PATCH /quotes/[quoteId]/lines/[lineId]",
        );
    }
}

/**
 * DELETE /api/workspaces/[workspaceId]/quotes/[quoteId]/lines/[lineId]
 * Removes a line item from a DRAFT quote and recalculates totals.
 */
export async function DELETE(request: Request, context: RouteContext) {
    try {
        const {
            workspaceId: pathWorkspaceId,
            quoteId,
            lineId,
        } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const quote = await removeQuoteLineItem(workspaceId, quoteId, lineId);

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(
            error,
            "DELETE /quotes/[quoteId]/lines/[lineId]",
        );
    }
}
