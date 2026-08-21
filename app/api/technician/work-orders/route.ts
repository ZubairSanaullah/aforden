import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    listTechnicianWorkOrders,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { technicianWorkOrderQuerySchema } from "@/lib/services/technicianOperations/technicianOperations.types";

/**
 * GET /api/technician/work-orders
 *
 * Lists paginated operational work orders assigned to the authenticated technician.
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
                { status: 400 }
            );
        }

        const context = await resolveTechnicianContext(workspaceId);

        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const queryInput: Record<string, any> = {};

        if (searchParams.has("status")) queryInput.status = searchParams.get("status")!;
        if (searchParams.has("priority")) queryInput.priority = searchParams.get("priority")!;
        if (searchParams.has("customerId")) queryInput.customerId = searchParams.get("customerId")!;
        if (searchParams.has("locationId")) queryInput.locationId = searchParams.get("locationId")!;
        if (searchParams.has("workTypeId")) queryInput.workTypeId = searchParams.get("workTypeId")!;
        if (searchParams.has("search")) queryInput.search = searchParams.get("search")!;
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("pageSize")) queryInput.pageSize = searchParams.get("pageSize")!;
        if (searchParams.has("sortBy")) queryInput.sortBy = searchParams.get("sortBy")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const validatedQuery = technicianWorkOrderQuerySchema.parse(queryInput);
        const result = await listTechnicianWorkOrders(context, validatedQuery);

        return NextResponse.json(
            {
                success: true,
                data: result.items,
                pagination: result.pagination,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "List technician work orders");
    }
}
