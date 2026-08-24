import { NextResponse } from "next/server";
import { getParts } from "@/lib/services/inventory/part/getParts";
import { createPart } from "@/lib/services/inventory/part/createPart";
import {
    resolveWorkspaceId,
    extractQueryParams,
    handleInventoryApiError,
} from "@/lib/utils/inventoryApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/inventory/parts
 * Lists paginated, filtered, and sorted Parts for the authorized workspace.
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
        const result = await getParts(workspaceId, query);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "GET /parts");
    }
}

/**
 * POST /api/workspaces/[workspaceId]/inventory/parts
 * Creates a new Part in the catalog under the authorized workspace.
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

        const part = await createPart(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: part,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "POST /parts");
    }
}
