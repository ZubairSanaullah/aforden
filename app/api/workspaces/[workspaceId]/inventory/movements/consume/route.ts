import { NextResponse } from "next/server";
import { consumeStock } from "@/lib/services/inventory/movement/consumeStock";
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
 * POST /api/workspaces/[workspaceId]/inventory/movements/consume
 * Fulfills reserved stock and records physical consumption against a WorkOrder.
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

        const result = await consumeStock(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "POST /movements/consume");
    }
}
