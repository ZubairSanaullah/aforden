import { NextResponse } from "next/server";
import { listTechnicianStock } from "@/lib/services/inventory/balance/listTechnicianStock";
import {
    resolveWorkspaceId,
    extractQueryParams,
    handleInventoryApiError,
} from "@/lib/utils/inventoryApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        technicianProfileId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/inventory/technician-stock/[technicianProfileId]
 * Lists all stock across vehicle locations assigned to a specific technician profile.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, technicianProfileId } =
            await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const query = extractQueryParams(request);
        const result = await listTechnicianStock(
            workspaceId,
            technicianProfileId,
            query,
        );

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(
            error,
            "GET /technician-stock/[technicianProfileId]",
        );
    }
}
