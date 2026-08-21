import { NextResponse } from "next/server";
import { getAssetOperationalSummary } from "@/lib/services/asset";
import {
    extractWorkspaceId,
    handleAssetApiError,
} from "@/lib/utils/assetApiError";

/**
 * GET /api/assets/summary
 *
 * Retrieves operational status breakdown and category metrics for dashboard display.
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

        const summary = await getAssetOperationalSummary(workspaceId);

        return NextResponse.json(
            {
                success: true,
                data: summary,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Get asset operational summary");
    }
}
