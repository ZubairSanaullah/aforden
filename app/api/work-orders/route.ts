import { NextResponse } from "next/server";
import {
    getWorkOrders,
    createWorkOrder,
} from "@/lib/services/workOrder";
import {
    extractWorkspaceId,
    handleWorkOrderApiError,
} from "@/lib/utils/workOrderApiError";

/**
 * GET /api/work-orders
 *
 * Lists paginated, filtered, searched, and sorted WorkOrders for the authorized workspace.
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
        if (searchParams.has("customerId")) queryInput.customerId = searchParams.get("customerId")!;
        if (searchParams.has("locationId")) queryInput.locationId = searchParams.get("locationId")!;
        if (searchParams.has("workTypeId")) queryInput.workTypeId = searchParams.get("workTypeId")!;
        if (searchParams.has("assignedTechnicianId")) queryInput.assignedTechnicianId = searchParams.get("assignedTechnicianId")!;
        if (searchParams.has("status")) queryInput.status = searchParams.get("status")!;
        if (searchParams.has("priority")) queryInput.priority = searchParams.get("priority")!;
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("pageSize")) queryInput.pageSize = searchParams.get("pageSize")!;
        if (searchParams.has("sortBy")) queryInput.sortBy = searchParams.get("sortBy")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const result = await getWorkOrders(workspaceId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "List work orders");
    }
}

/**
 * POST /api/work-orders
 *
 * Creates a new WorkOrder under the authorized workspace.
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

        const workOrder = await createWorkOrder(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: workOrder,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Create work order");
    }
}
