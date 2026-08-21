import { NextResponse } from "next/server";
import {
    getAssets,
    createAsset,
} from "@/lib/services/asset";
import {
    extractWorkspaceId,
    handleAssetApiError,
} from "@/lib/utils/assetApiError";

/**
 * GET /api/assets
 *
 * Lists paginated, filtered, searched, and sorted Assets for the authorized workspace.
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

        if (searchParams.has("search")) queryInput.search = searchParams.get("search")!;
        if (searchParams.has("status")) queryInput.status = searchParams.get("status")!;
        if (searchParams.has("customerId")) queryInput.customerId = searchParams.get("customerId")!;
        if (searchParams.has("locationId")) queryInput.locationId = searchParams.get("locationId")!;
        if (searchParams.has("categoryId")) queryInput.categoryId = searchParams.get("categoryId")!;
        if (searchParams.has("manufacturer")) queryInput.manufacturer = searchParams.get("manufacturer")!;
        if (searchParams.has("tags")) {
            const tagsVal = searchParams.get("tags")!;
            queryInput.tags = tagsVal.includes(",") ? tagsVal.split(",").map((t) => t.trim()).filter(Boolean) : tagsVal;
        }
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("pageSize")) queryInput.pageSize = searchParams.get("pageSize")!;
        if (searchParams.has("sortBy")) queryInput.sortBy = searchParams.get("sortBy")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const result = await getAssets(workspaceId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "List assets");
    }
}

/**
 * POST /api/assets
 *
 * Creates a new physical or depot Asset in the authorized workspace.
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

        const asset = await createAsset(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: asset,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Create asset");
    }
}
