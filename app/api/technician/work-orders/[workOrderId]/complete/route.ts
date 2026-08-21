import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    completeTechnicianWorkOrder,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { completeWorkOrderSchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
    }>;
}

/**
 * POST /api/technician/work-orders/[workOrderId]/complete
 *
 * Completes an in-progress work order with optional resolution notes and media evidence.
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

        const validatedInput = completeWorkOrderSchema.parse(body);
        const workOrder = await completeTechnicianWorkOrder(techContext, workOrderId, validatedInput);

        // DTO Hygiene (§14 Step 7): Ensure internal plumbing properties are never serialized
        const { _historyRecordId, ...cleanDto } = workOrder as any;

        return NextResponse.json(
            {
                success: true,
                data: cleanDto,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Complete technician work order");
    }
}
