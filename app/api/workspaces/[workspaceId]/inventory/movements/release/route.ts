import { NextResponse } from "next/server";
import { releaseStock } from "@/lib/services/inventory/movement/releaseStock";
import {
    resolveWorkspaceId,
    handleInventoryApiError,
} from "@/lib/utils/inventoryApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/inventory/movements/release
 * Un-earmarks reserved stock at a location, returning it to general available stock.
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

        const result = await releaseStock(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "POST /movements/release");
    }
}
