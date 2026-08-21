import { NextResponse } from "next/server";
import { transitionAssetStatus } from "@/lib/services/asset";
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
 * PATCH /api/assets/[assetId]/status
 *
 * Transitions asset lifecycle status with finite state machine validation and side effects.
 * Also handles permanent retirement when toStatus is "RETIRED".
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

        const transitioned = await transitionAssetStatus(workspaceId, assetId, body);

        return NextResponse.json(
            {
                success: true,
                data: transitioned,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleAssetApiError(error, "Transition asset status");
    }
}
