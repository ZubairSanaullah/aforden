import { NextResponse } from "next/server";
import {
    getAssetCategory,
    updateAssetCategory,
    deleteAssetCategory,
} from "@/lib/services/assetCategory";
import {
    extractWorkspaceId,
    handleAssetApiError,
} from "@/lib/utils/assetApiError";

interface RouteContext {
    params: Promise<{
        categoryId: string;
    }>;
}

/**
 * GET /api/asset-categories/[categoryId]
 *
 * Retrieves a single AssetCategory by ID.
 */
export async function GET(
    request: Request,
    context: RouteContext,
) {
    try {
        const { categoryId } = await context.params;
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

        const category = await getAssetCategory(workspaceId, categoryId);

        return NextResponse.json(
            {
                success: true,
                data: category,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Get asset category");
    }
}

/**
 * PATCH /api/asset-categories/[categoryId]
 *
 * Updates mutable fields or toggles status (ACTIVE/INACTIVE) of an AssetCategory.
 */
export async function PATCH(
    request: Request,
    context: RouteContext,
) {
    try {
        const { categoryId } = await context.params;
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

        const updated = await updateAssetCategory(workspaceId, categoryId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Update asset category");
    }
}

/**
 * DELETE /api/asset-categories/[categoryId]
 *
 * Hard-deletes an unreferenced AssetCategory with zero downstream Asset references.
 */
export async function DELETE(
    request: Request,
    context: RouteContext,
) {
    try {
        const { categoryId } = await context.params;
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

        const deleted = await deleteAssetCategory(workspaceId, categoryId);

        return NextResponse.json(
            {
                success: true,
                data: deleted,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Delete asset category");
    }
}
