import { NextResponse } from "next/server";
import { receiveStock } from "@/lib/services/inventory/movement/receiveStock";
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
 * POST /api/workspaces/[workspaceId]/inventory/movements/receive
 * Ingests new stock into an inventory location.
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

        const result = await receiveStock(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "POST /movements/receive");
    }
}
