import { NextResponse } from "next/server";
import {
    assignWorkOrder,
    unassignWorkOrder,
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
 * POST /api/work-orders/[workOrderId]/assignment
 *
 * Assigns an unassigned WorkOrder to a Technician.
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

        const assigned = await assignWorkOrder(workspaceId, workOrderId, body);

        return NextResponse.json(
            {
                success: true,
                data: assigned,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Assign work order");
    }
}

/**
 * DELETE /api/work-orders/[workOrderId]/assignment
 *
 * Unassigns an assigned WorkOrder.
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

        const unassigned = await unassignWorkOrder(workspaceId, workOrderId);

        return NextResponse.json(
            {
                success: true,
                data: unassigned,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleWorkOrderApiError(error, "Unassign work order");
    }
}
