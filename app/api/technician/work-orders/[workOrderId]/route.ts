import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    getTechnicianWorkOrderDetail,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
    }>;
}

/**
 * GET /api/technician/work-orders/[workOrderId]
 *
 * Retrieves operational detail for a work order assigned to the authenticated technician.
 */
export async function GET(request: Request, context: RouteContext) {
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
        const workOrder = await getTechnicianWorkOrderDetail(techContext, workOrderId);

        return NextResponse.json(
            {
                success: true,
                data: workOrder,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Get technician work order detail");
    }
}
