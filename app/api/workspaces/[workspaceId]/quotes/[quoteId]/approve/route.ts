import { NextResponse } from "next/server";
import { approveQuote } from "@/lib/services/quote";
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
 * POST /api/workspaces/[workspaceId]/quotes/[quoteId]/approve
 * Transitions quote status from PENDING_APPROVAL to APPROVED.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, quoteId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        let body: unknown = undefined;
        try {
            const text = await request.text();
            if (text.trim().length > 0) {
                body = JSON.parse(text);
            }
        } catch {
            throw new SyntaxError("Invalid JSON in request body.");
        }

        const quote = await approveQuote(workspaceId, quoteId, body);

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "POST /quotes/[quoteId]/approve");
    }
}
