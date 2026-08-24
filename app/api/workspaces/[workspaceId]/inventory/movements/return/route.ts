import { NextResponse } from "next/server";
import { returnStock } from "@/lib/services/inventory/movement/returnStock";
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
 * POST /api/workspaces/[workspaceId]/inventory/movements/return
 * Reverses work order consumption and restores stock on hand.
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

        const result = await returnStock(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "POST /movements/return");
    }
}
