import { NextResponse } from "next/server";
import { transitionPartStatus } from "@/lib/services/inventory/part/transitionPartStatus";
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
 * POST /api/workspaces/[workspaceId]/inventory/parts/[partId]/status
 * Transitions the operational status of a Part (ACTIVE <-> INACTIVE).
 */
export async function POST(request: Request, context: RouteContext) {
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

        const updated = await transitionPartStatus(workspaceId, partId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInventoryApiError(error, "POST /parts/[partId]/status");
    }
}
