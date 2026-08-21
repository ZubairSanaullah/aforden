import { NextResponse } from "next/server";
import { getAssetHistory } from "@/lib/services/asset";
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
 * GET /api/assets/[assetId]/history
 *
 * Retrieves paginated audit history and lifecycle event timeline for an Asset.
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

        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const queryInput: Record<string, any> = {};

        if (searchParams.has("eventType")) {
            const eventTypeVal = searchParams.get("eventType")!;
            queryInput.eventType = eventTypeVal.includes(",")
                ? eventTypeVal.split(",").map((s) => s.trim()).filter(Boolean)
                : eventTypeVal;
        }
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("pageSize")) queryInput.pageSize = searchParams.get("pageSize")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const result = await getAssetHistory(workspaceId, assetId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Get asset history");
    }
}
