import { NextResponse } from "next/server";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder";
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
 * Handles status transition request for a WorkOrder.
 */
async function handleStatusTransition(
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

        const transitioned = await transitionWorkOrderStatus(
            workspaceId,
            workOrderId,
            body,
        );

        return NextResponse.json(
            {
                success: true,
                data: transitioned,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Transition work order status");
    }
}

/**
 * POST /api/work-orders/[workOrderId]/status
 */
export async function POST(
    request: Request,
    context: RouteContext,
) {
    return handleStatusTransition(request, context);
}

/**
 * PATCH /api/work-orders/[workOrderId]/status
 */
export async function PATCH(
    request: Request,
    context: RouteContext,
) {
    return handleStatusTransition(request, context);
}
