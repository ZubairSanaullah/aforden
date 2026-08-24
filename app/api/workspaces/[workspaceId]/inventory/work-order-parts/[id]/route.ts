import { NextResponse } from "next/server";
import { getWorkOrderPart } from "@/lib/services/inventory/workOrderPart/getWorkOrderPart";
import {
    resolveWorkspaceId,
    handleInventoryApiError,
} from "@/lib/utils/inventoryApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        id: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/inventory/work-order-parts/[id]
 * Retrieves details of a specific WorkOrderPart consumption record.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, id } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const workOrderPart = await getWorkOrderPart(workspaceId, id);

        return NextResponse.json(
            {
                success: true,
                data: workOrderPart,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(
            error,
            "GET /work-order-parts/[id]",
        );
    }
}
