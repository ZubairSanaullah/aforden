import { NextResponse } from "next/server";
import { listReservations } from "@/lib/services/inventory/balance/listReservations";
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
 * GET /api/workspaces/[workspaceId]/inventory/reservations
 * Lists balances with active reservations (`quantityReserved > 0`).
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
        const result = await listReservations(workspaceId, query);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "GET /reservations");
    }
}
