import { NextResponse } from "next/server";
import { changeWorkTypeStatus } from "@/lib/services/workType";
import {
    extractWorkspaceId,
    handleServiceCatalogApiError,
} from "@/lib/utils/serviceCatalogApiError";

interface RouteContext {
    params: Promise<{
        workTypeId: string;
    }>;
}

/**
 * PATCH /api/work-types/[workTypeId]/status
 *
 * Transitions the operational lifecycle status of a WorkType.
 */
export async function PATCH(
    request: Request,
    context: RouteContext,
) {
    try {
        const { workTypeId } = await context.params;
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

        const updated = await changeWorkTypeStatus(workspaceId, workTypeId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Change work type status");
    }
}
