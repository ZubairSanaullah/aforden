import { NextResponse } from "next/server";
import { updateTechnicianTimeEntryAdmin } from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { adminUpdateTechnicianTimeEntrySchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
        id: string;
    }>;
}

/**
 * PATCH /api/work-orders/[workOrderId]/time/[id]
 *
 * Administrative modification of historical technician time entry (OWNER, ADMIN, MANAGER roles).
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

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const validatedInput = adminUpdateTechnicianTimeEntrySchema.parse(body);
        const updatedEntry = await updateTechnicianTimeEntryAdmin(
            workspaceId,
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
        return handleTechnicianOperationsApiError(error, "Admin update technician time entry");
    }
}
