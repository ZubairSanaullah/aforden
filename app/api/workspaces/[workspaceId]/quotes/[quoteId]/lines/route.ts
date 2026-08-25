import { NextResponse } from "next/server";
import { addQuoteLineItem } from "@/lib/services/quote";
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
 * POST /api/workspaces/[workspaceId]/quotes/[quoteId]/lines
 * Adds a line item to a DRAFT quote and recalculates totals.
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

        const quote = await addQuoteLineItem(workspaceId, quoteId, body);

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "POST /quotes/[quoteId]/lines");
    }
}
