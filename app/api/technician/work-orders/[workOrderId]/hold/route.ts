import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    holdTechnicianWorkOrder,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { holdWorkOrderSchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
    }>;
}

/**
 * POST /api/technician/work-orders/[workOrderId]/hold
 *
 * Places an in-progress work order on operational hold.
 */
export async function POST(request: Request, context: RouteContext) {
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
                { status: 400 }
            );
        }

        const techContext = await resolveTechnicianContext(workspaceId);

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const validatedInput = holdWorkOrderSchema.parse(body);
        const workOrder = await holdTechnicianWorkOrder(techContext, workOrderId, validatedInput);

        return NextResponse.json(
            {
                success: true,
                data: workOrder,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Hold technician work order");
    }
}
