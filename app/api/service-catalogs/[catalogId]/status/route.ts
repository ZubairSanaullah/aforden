import { NextResponse } from "next/server";
import { changeServiceCatalogStatus } from "@/lib/services/serviceCatalog";
import {
    extractWorkspaceId,
    handleServiceCatalogApiError,
} from "@/lib/utils/serviceCatalogApiError";

interface RouteContext {
    params: Promise<{
        catalogId: string;
    }>;
}

/**
 * PATCH /api/service-catalogs/[catalogId]/status
 *
 * Transitions the operational lifecycle status of a ServiceCatalog.
 */
export async function PATCH(
    request: Request,
    context: RouteContext,
) {
    try {
        const { catalogId } = await context.params;
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

        const updated = await changeServiceCatalogStatus(workspaceId, catalogId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Change service catalog status");
    }
}
