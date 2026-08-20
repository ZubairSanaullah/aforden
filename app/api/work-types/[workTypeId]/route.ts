import { NextResponse } from "next/server";
import {
    getWorkType,
    updateWorkType,
    deleteWorkType,
} from "@/lib/services/workType";
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
 * GET /api/work-types/[workTypeId]
 *
 * Retrieves operational read model of a single WorkType.
 */
export async function GET(
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

        const workType = await getWorkType(workspaceId, workTypeId);

        return NextResponse.json(
            {
                success: true,
                data: workType,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Get work type");
    }
}

/**
 * PATCH /api/work-types/[workTypeId]
 *
 * Updates mutable definition fields of a WorkType.
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

        const updated = await updateWorkType(workspaceId, workTypeId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Update work type");
    }
}

/**
 * DELETE /api/work-types/[workTypeId]
 *
 * Hard deletes an INACTIVE, unreferenced WorkType.
 */
export async function DELETE(
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

        const deleted = await deleteWorkType(workspaceId, workTypeId);

        return NextResponse.json(
            {
                success: true,
                data: deleted,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Delete work type");
    }
}
