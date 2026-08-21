import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    startTechnicianWorkOrder,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { startWorkOrderSchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
    }>;
}

/**
 * POST /api/technician/work-orders/[workOrderId]/start
 *
 * Starts on-site physical execution on the work order.
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

        let body: unknown = {};
        const text = await request.text();
        if (text.trim()) {
            try {
                body = JSON.parse(text);
            } catch {
                throw new SyntaxError("Invalid JSON in request body.");
            }
        }

        const validatedInput = startWorkOrderSchema.parse(body);
        const workOrder = await startTechnicianWorkOrder(techContext, workOrderId, validatedInput);

        return NextResponse.json(
            {
                success: true,
                data: workOrder,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Start technician work order");
    }
}
