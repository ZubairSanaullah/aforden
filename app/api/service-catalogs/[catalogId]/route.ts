import { NextResponse } from "next/server";
import {
    getServiceCatalog,
    updateServiceCatalog,
    deleteServiceCatalog,
} from "@/lib/services/serviceCatalog";
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
 * GET /api/service-catalogs/[catalogId]
 *
 * Retrieves operational read model of a single ServiceCatalog.
 */
export async function GET(
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

        const catalog = await getServiceCatalog(workspaceId, catalogId);

        return NextResponse.json(
            {
                success: true,
                data: catalog,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Get service catalog");
    }
}

/**
 * PATCH /api/service-catalogs/[catalogId]
 *
 * Updates mutable definition fields of a ServiceCatalog.
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

        const updated = await updateServiceCatalog(workspaceId, catalogId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Update service catalog");
    }
}

/**
 * DELETE /api/service-catalogs/[catalogId]
 *
 * Hard deletes an INACTIVE and empty ServiceCatalog.
 */
export async function DELETE(
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

        const deleted = await deleteServiceCatalog(workspaceId, catalogId);

        return NextResponse.json(
            {
                success: true,
                data: deleted,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Delete service catalog");
    }
}
