import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    acknowledgeTechnicianDispatch,
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
 * POST /api/technician/work-orders/[workOrderId]/acknowledge
 *
 * Acknowledges dispatch on the technician's assigned work order and appointment.
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
        const appointment = await acknowledgeTechnicianDispatch(techContext, workOrderId);

        return NextResponse.json(
            {
                success: true,
                data: appointment,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Acknowledge technician dispatch");
    }
}
