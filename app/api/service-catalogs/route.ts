import { NextResponse } from "next/server";
import {
    getServiceCatalogs,
    createServiceCatalog,
} from "@/lib/services/serviceCatalog";
import {
    extractWorkspaceId,
    handleServiceCatalogApiError,
} from "@/lib/utils/serviceCatalogApiError";

/**
 * GET /api/service-catalogs
 *
 * Lists paginated, filtered, and sorted ServiceCatalogs for the authorized workspace.
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
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("pageSize")) queryInput.pageSize = searchParams.get("pageSize")!;
        if (searchParams.has("sortBy")) queryInput.sortBy = searchParams.get("sortBy")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const result = await getServiceCatalogs(workspaceId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "List service catalogs");
    }
}

/**
 * POST /api/service-catalogs
 *
 * Creates a new ServiceCatalog under the authorized workspace.
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

        const catalog = await createServiceCatalog(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: catalog,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleServiceCatalogApiError(error, "Create service catalog");
    }
}
