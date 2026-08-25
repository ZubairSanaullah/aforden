import { NextResponse } from "next/server";
import { reorderQuoteLineItems } from "@/lib/services/quote";
import {
    resolveWorkspaceId,
    handleQuoteApiError,
} from "@/lib/utils/quoteApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        quoteId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/quotes/[quoteId]/lines/reorder
 * Reorders line items on a DRAFT quote.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, quoteId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const quote = await reorderQuoteLineItems(workspaceId, quoteId, body);

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
            "POST /quotes/[quoteId]/lines/reorder",
        );
    }
}
