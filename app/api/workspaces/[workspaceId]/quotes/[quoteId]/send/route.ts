import { NextResponse } from "next/server";
import { sendQuote } from "@/lib/services/quote";
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
 * POST /api/workspaces/[workspaceId]/quotes/[quoteId]/send
 * Transitions quote status from DRAFT to PENDING_APPROVAL.
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

        const quote = await sendQuote(workspaceId, quoteId, body);

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "POST /quotes/[quoteId]/send");
    }
}
