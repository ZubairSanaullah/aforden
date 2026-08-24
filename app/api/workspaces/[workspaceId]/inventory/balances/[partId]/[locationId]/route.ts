import { NextResponse } from "next/server";
import { getInventoryBalance } from "@/lib/services/inventory/balance/getInventoryBalance";
import {
    resolveWorkspaceId,
    handleInventoryApiError,
} from "@/lib/utils/inventoryApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        partId: string;
        locationId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/inventory/balances/[partId]/[locationId]
 * Retrieves stock balance and availability for a specific (partId, locationId) tuple.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const {
            workspaceId: pathWorkspaceId,
            partId,
            locationId,
        } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const balance = await getInventoryBalance(
            workspaceId,
            partId,
            locationId,
        );

        return NextResponse.json(
            {
                success: true,
                data: balance,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(
            error,
            "GET /balances/[partId]/[locationId]",
        );
    }
}
