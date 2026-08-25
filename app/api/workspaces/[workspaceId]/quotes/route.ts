import { NextResponse } from "next/server";
import {
    listQuotes,
    createQuote,
} from "@/lib/services/quote";
import {
    resolveWorkspaceId,
    extractQueryParams,
    handleQuoteApiError,
} from "@/lib/utils/quoteApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/quotes
 * Lists paginated, filtered, searched, and sorted Quotes for the authorized workspace.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const query = extractQueryParams(request);
        const result = await listQuotes(workspaceId, query);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "GET /quotes");
    }
}

/**
 * POST /api/workspaces/[workspaceId]/quotes
 * Creates a new Quote under the authorized workspace.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const quote = await createQuote(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: quote,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleQuoteApiError(error, "POST /quotes");
    }
}
