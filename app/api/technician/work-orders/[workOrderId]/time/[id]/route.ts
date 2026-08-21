import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    updateTechnicianTimeEntry,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { updateTechnicianTimeEntrySchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
        id: string;
    }>;
}

/**
 * PATCH /api/technician/work-orders/[workOrderId]/time/[id]
 *
 * Updates or stops/closes an active time entry belonging to the authenticated technician.
 */
export async function PATCH(request: Request, context: RouteContext) {
    try {
        const { workOrderId, id } = await context.params;
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

        const validatedInput = updateTechnicianTimeEntrySchema.parse(body);
        const updatedEntry = await updateTechnicianTimeEntry(
            techContext,
            workOrderId,
            id,
            validatedInput
        );

        return NextResponse.json(
            {
                success: true,
                data: updatedEntry,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Update technician time entry");
    }
}
