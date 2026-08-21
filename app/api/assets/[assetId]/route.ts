import { NextResponse } from "next/server";
import {
    getAsset,
    updateAsset,
    deleteAsset,
} from "@/lib/services/asset";
import {
    extractWorkspaceId,
    handleAssetApiError,
} from "@/lib/utils/assetApiError";

interface RouteContext {
    params: Promise<{
        assetId: string;
    }>;
}

/**
 * GET /api/assets/[assetId]
 *
 * Retrieves canonical detailed view model for a single Asset.
 */
export async function GET(
    request: Request,
    context: RouteContext,
) {
    try {
        const { assetId } = await context.params;
        const workspaceId = extractWorkspaceId(request);

        if (!workspaceId) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "MISSING_WORKSPACE",
                        message: "Workspace ID is required.",
                    },
                },
                { status: 400 },
            );
        }

        const asset = await getAsset(workspaceId, assetId);

        return NextResponse.json(
            {
                success: true,
                data: asset,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Get asset");
    }
}

/**
 * PATCH /api/assets/[assetId]
 *
 * Updates mutable fields of an Asset with field-level diff logging.
 */
export async function PATCH(
    request: Request,
    context: RouteContext,
) {
    try {
        const { assetId } = await context.params;
        const workspaceId = extractWorkspaceId(request);

        if (!workspaceId) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "MISSING_WORKSPACE",
                        message: "Workspace ID is required.",
                    },
                },
                { status: 400 },
            );
        }

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const updated = await updateAsset(workspaceId, assetId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Update asset");
    }
}

/**
 * DELETE /api/assets/[assetId]
 *
 * Hard-deletes an unreferenced Asset with zero historical WorkOrders.
 */
export async function DELETE(
    request: Request,
    context: RouteContext,
) {
    try {
        const { assetId } = await context.params;
        const workspaceId = extractWorkspaceId(request);

        if (!workspaceId) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "MISSING_WORKSPACE",
                        message: "Workspace ID is required.",
                    },
                },
                { status: 400 },
            );
        }

        const deleted = await deleteAsset(workspaceId, assetId);

        return NextResponse.json(
            {
                success: true,
                data: deleted,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Delete asset");
    }
}
