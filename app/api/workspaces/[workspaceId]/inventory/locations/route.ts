import { NextResponse } from "next/server";
import { getInventoryLocations } from "@/lib/services/inventory/inventoryLocation/getInventoryLocations";
import { createInventoryLocation } from "@/lib/services/inventory/inventoryLocation/createInventoryLocation";
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
 * GET /api/workspaces/[workspaceId]/inventory/locations
 * Lists paginated, filtered, and sorted InventoryLocations for the authorized workspace.
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
        const result = await getInventoryLocations(workspaceId, query);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "GET /locations");
    }
}

/**
 * POST /api/workspaces/[workspaceId]/inventory/locations
 * Creates a new InventoryLocation in the authorized workspace.
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

        const location = await createInventoryLocation(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: location,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "POST /locations");
    }
}
