import { NextResponse } from "next/server";
import { getWorkOrderHistory } from "@/lib/services/workOrder";
import {
    extractWorkspaceId,
    handleWorkOrderApiError,
} from "@/lib/utils/workOrderApiError";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
    }>;
}

/**
 * GET /api/work-orders/[workOrderId]/history
 *
 * Retrieves the operational history and audit timeline of a WorkOrder.
 */
export async function GET(
    request: Request,
    context: RouteContext,
) {
    try {
        const { workOrderId } = await context.params;
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
        const searchParams = Object.fromEntries(url.searchParams.entries());

        const history = await getWorkOrderHistory(
            workspaceId,
            workOrderId,
            searchParams,
        );

        return NextResponse.json(
            {
                success: true,
                data: history,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Get work order history");
    }
}
