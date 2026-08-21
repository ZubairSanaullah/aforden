import { NextResponse } from "next/server";
import {
    transferAssetLocation,
    transferAssetOwnership,
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
 * POST /api/assets/[assetId]/transfer
 *
 * Dispatches to transferAssetOwnership or transferAssetLocation based on payload:
 * - If payload contains `customerId`: invokes transferAssetOwnership
 * - Else if payload contains `locationId`: invokes transferAssetLocation
 * - Else returns 422 validation error
 */
export async function POST(
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

        if (body && typeof body === "object" && "customerId" in body) {
            // Ownership transfer
            const updated = await transferAssetOwnership(workspaceId, assetId, body);
            return NextResponse.json(
                {
                    success: true,
                    data: updated,
                },
                { status: 200 },
            );
        } else if (body && typeof body === "object" && "locationId" in body) {
            // Location transfer
            const updated = await transferAssetLocation(workspaceId, assetId, body);
            return NextResponse.json(
                {
                    success: true,
                    data: updated,
                },
                { status: 200 },
            );
        } else {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message:
                            "Transfer payload must include either 'customerId' (for ownership transfer) or 'locationId' (for location transfer).",
                    },
                },
                { status: 422 },
            );
        }
    } catch (error) {
        return handleAssetApiError(error, "Transfer asset");
    }
}
