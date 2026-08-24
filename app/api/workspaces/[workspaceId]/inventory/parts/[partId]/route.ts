import { NextResponse } from "next/server";
import { getPart } from "@/lib/services/inventory/part/getPart";
import { updatePart } from "@/lib/services/inventory/part/updatePart";
import {
    resolveWorkspaceId,
    handleInventoryApiError,
} from "@/lib/utils/inventoryApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        partId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/inventory/parts/[partId]
 * Retrieves details for a specific catalog Part in the authorized workspace.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, partId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const part = await getPart(workspaceId, partId);

        return NextResponse.json(
            {
                success: true,
                data: part,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "GET /parts/[partId]");
    }
}

/**
 * PATCH /api/workspaces/[workspaceId]/inventory/parts/[partId]
 * Updates fields of an existing Part in the catalog.
 */
export async function PATCH(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, partId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const updated = await updatePart(workspaceId, partId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "PATCH /parts/[partId]");
    }
}
