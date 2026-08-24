import { NextResponse } from "next/server";
import { getWorkOrderParts } from "@/lib/services/inventory/workOrderPart/getWorkOrderParts";
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
 * GET /api/workspaces/[workspaceId]/inventory/work-order-parts
 * Lists paginated, filtered WorkOrderPart consumption audit records.
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
        const result = await getWorkOrderParts(workspaceId, query);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "GET /work-order-parts");
    }
}
