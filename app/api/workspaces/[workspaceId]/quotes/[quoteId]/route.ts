import { NextResponse } from "next/server";
import {
    getQuote,
    updateQuote,
    deleteQuote,
} from "@/lib/services/quote";
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
 * GET /api/workspaces/[workspaceId]/quotes/[quoteId]
 * Retrieves a single Quote by ID with line items and relationships.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, quoteId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const quote = await getQuote(workspaceId, quoteId);

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "GET /quotes/[quoteId]");
    }
}

/**
 * PATCH /api/workspaces/[workspaceId]/quotes/[quoteId]
 * Updates an existing Quote header and triggers recalculations when relevant.
 */
export async function PATCH(request: Request, context: RouteContext) {
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

        const quote = await updateQuote(workspaceId, quoteId, body);

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "PATCH /quotes/[quoteId]");
    }
}

/**
 * DELETE /api/workspaces/[workspaceId]/quotes/[quoteId]
 * Deletes a DRAFT quote from the workspace.
 */
export async function DELETE(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, quoteId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const result = await deleteQuote(workspaceId, quoteId);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "DELETE /quotes/[quoteId]");
    }
}
