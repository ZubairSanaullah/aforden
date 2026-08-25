import { NextResponse } from "next/server";
import { getQuoteTimelineSummary } from "@/lib/services/quote";
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
 * GET /api/workspaces/[workspaceId]/quotes/[quoteId]/timeline
 * Derives key milestone timestamps and lifecycle status directly from the Quote row.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, quoteId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const summary = await getQuoteTimelineSummary(workspaceId, quoteId);

        return NextResponse.json(
            {
                success: true,
                data: summary,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(
            error,
            "GET /quotes/[quoteId]/timeline",
        );
    }
}
