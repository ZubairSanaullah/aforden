import { NextResponse } from "next/server";
import { getInventoryLocation } from "@/lib/services/inventory/inventoryLocation/getInventoryLocation";
import { updateInventoryLocation } from "@/lib/services/inventory/inventoryLocation/updateInventoryLocation";
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
 * GET /api/workspaces/[workspaceId]/inventory/locations/[locationId]
 * Retrieves details for a specific InventoryLocation in the authorized workspace.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, locationId } =
            await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const location = await getInventoryLocation(workspaceId, locationId);

        return NextResponse.json(
            {
                success: true,
                data: location,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "GET /locations/[locationId]");
    }
}

/**
 * PATCH /api/workspaces/[workspaceId]/inventory/locations/[locationId]
 * Updates attributes of an existing InventoryLocation.
 */
export async function PATCH(request: Request, context: RouteContext) {
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

        const updated = await updateInventoryLocation(
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
        return handleInventoryApiError(error, "PATCH /locations/[locationId]");
    }
}
