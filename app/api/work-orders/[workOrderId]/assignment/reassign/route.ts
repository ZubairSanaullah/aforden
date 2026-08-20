import { NextResponse } from "next/server";
import { reassignWorkOrder } from "@/lib/services/workOrder";
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
 * POST /api/work-orders/[workOrderId]/assignment/reassign
 *
 * Reassigns an already assigned WorkOrder to another Technician.
 */
export async function POST(
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

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const reassigned = await reassignWorkOrder(
            workspaceId,
            workOrderId,
            body,
        );

        return NextResponse.json(
            {
                success: true,
                data: reassigned,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Reassign work order");
    }
}
