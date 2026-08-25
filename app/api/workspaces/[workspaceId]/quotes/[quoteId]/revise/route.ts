import { NextResponse } from "next/server";
import { reviseQuote } from "@/lib/services/quote";
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
 * POST /api/workspaces/[workspaceId]/quotes/[quoteId]/revise
 * Transitions quote status from PENDING_APPROVAL back to DRAFT for modifications.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, quoteId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const quote = await reviseQuote(workspaceId, quoteId);

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "POST /quotes/[quoteId]/revise");
    }
}
