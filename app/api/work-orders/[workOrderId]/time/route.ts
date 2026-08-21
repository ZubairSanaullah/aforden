import { NextResponse } from "next/server";
import { listTechnicianTimeEntriesAdmin } from "@/lib/services/technicianOperations";
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
 * GET /api/work-orders/[workOrderId]/time
 *
 * Administrative listing of all technician time entries for a work order across the workspace.
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

        const entries = await listTechnicianTimeEntriesAdmin(workspaceId, workOrderId);

        return NextResponse.json(
            {
                success: true,
                data: entries,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Admin list technician time entries");
    }
}
