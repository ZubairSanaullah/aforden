import { NextResponse } from "next/server";
import {
    getWorkOrder,
    updateWorkOrder,
    deleteWorkOrder,
} from "@/lib/services/workOrder";
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
 * GET /api/work-orders/[workOrderId]
 *
 * Retrieves operational read model of a single WorkOrder.
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

        const workOrder = await getWorkOrder(workspaceId, workOrderId);

        return NextResponse.json(
            {
                success: true,
                data: workOrder,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Get work order");
    }
}

/**
 * PATCH /api/work-orders/[workOrderId]
 *
 * Updates mutable operational fields of an existing WorkOrder.
 */
export async function PATCH(
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

        const updated = await updateWorkOrder(workspaceId, workOrderId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Update work order");
    }
}

/**
 * DELETE /api/work-orders/[workOrderId]
 *
 * Administratively deletes an eligible (OPEN or CANCELLED) WorkOrder.
 */
export async function DELETE(
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

        const deleted = await deleteWorkOrder(workspaceId, workOrderId);

        return NextResponse.json(
            {
                success: true,
                data: deleted,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Delete work order");
    }
}
