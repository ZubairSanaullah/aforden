import { NextResponse } from "next/server";
import { getQuoteHistory } from "@/lib/services/quote";
import {
    resolveWorkspaceId,
    extractQueryParams,
    handleQuoteApiError,
} from "@/lib/utils/quoteApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        quoteId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/quotes/[quoteId]/history
 * Retrieves paginated audit history timeline for a quote.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, quoteId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const query = extractQueryParams(request);
        const result = await getQuoteHistory(
            workspaceId,
            quoteId,
            undefined,
            query,
        );

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(
            error,
            "GET /quotes/[quoteId]/history",
        );
    }
}
