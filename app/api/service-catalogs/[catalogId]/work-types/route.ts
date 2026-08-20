import { NextResponse } from "next/server";
import {
    getWorkTypes,
    createWorkType,
} from "@/lib/services/workType";
import { getServiceCatalog } from "@/lib/services/serviceCatalog";
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
 * GET /api/service-catalogs/[catalogId]/work-types
 *
 * Lists WorkTypes scoped to a specific parent ServiceCatalog.
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

        // Verify catalog exists within authorized workspace (throws ServiceCatalogNotFoundError if cross-tenant)
        await getServiceCatalog(workspaceId, catalogId);

        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const queryInput: Record<string, any> = {
            catalogId,
        };

        if (searchParams.has("search")) queryInput.search = searchParams.get("search")!;
        if (searchParams.has("status")) queryInput.status = searchParams.get("status")!;
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("pageSize")) queryInput.pageSize = searchParams.get("pageSize")!;
        if (searchParams.has("sortBy")) queryInput.sortBy = searchParams.get("sortBy")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const result = await getWorkTypes(workspaceId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "List catalog work types");
    }
}

/**
 * POST /api/service-catalogs/[catalogId]/work-types
 *
 * Creates a new WorkType attached to the specified parent ServiceCatalog.
 */
export async function POST(
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

        // Enforce URL catalogId
        const input = {
            ...body,
            catalogId,
        };

        const workType = await createWorkType(workspaceId, input);

        return NextResponse.json(
            {
                success: true,
                data: workType,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Create catalog work type");
    }
}
