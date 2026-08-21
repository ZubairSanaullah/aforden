import { NextResponse } from "next/server";
import {
    getAssetCategories,
    createAssetCategory,
} from "@/lib/services/assetCategory";
import {
    extractWorkspaceId,
    handleAssetApiError,
} from "@/lib/utils/assetApiError";

/**
 * GET /api/asset-categories
 *
 * Lists equipment categories for the authorized workspace.
 */
export async function GET(request: Request) {
    try {
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

        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const queryInput: Record<string, any> = {};

        if (searchParams.has("status")) queryInput.status = searchParams.get("status")!;
        if (searchParams.has("search")) queryInput.search = searchParams.get("search")!;
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("pageSize")) queryInput.pageSize = searchParams.get("pageSize")!;
        if (searchParams.has("sortBy")) queryInput.sortBy = searchParams.get("sortBy")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const result = await getAssetCategories(workspaceId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "List asset categories");
    }
}

/**
 * POST /api/asset-categories
 *
 * Creates a new AssetCategory in the authorized workspace.
 */
export async function POST(request: Request) {
    try {
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

        const category = await createAssetCategory(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: category,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Create asset category");
    }
}
