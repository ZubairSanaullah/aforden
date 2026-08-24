import { NextResponse } from "next/server";
import { transitionInventoryLocationStatus } from "@/lib/services/inventory/inventoryLocation/transitionInventoryLocationStatus";
import {
    resolveWorkspaceId,
    handleInventoryApiError,
} from "@/lib/utils/inventoryApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        locationId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/inventory/locations/[locationId]/status
 * Transitions the operational status of an InventoryLocation (ACTIVE <-> INACTIVE).
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, locationId } =
            await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const updated = await transitionInventoryLocationStatus(
            workspaceId,
            locationId,
            body,
        );

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(
            error,
            "POST /locations/[locationId]/status",
        );
    }
}
