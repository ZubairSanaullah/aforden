import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    listTechnicianTimeEntries,
    recordTechnicianTimeEntry,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { recordTechnicianTimeEntrySchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
    }>;
}

/**
 * GET /api/technician/work-orders/[workOrderId]/time
 *
 * Lists time entries belonging to the authenticated technician on the specified work order.
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
        const entries = await listTechnicianTimeEntries(techContext, workOrderId);

        return NextResponse.json(
            {
                success: true,
                data: entries,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "List technician time entries");
    }
}

/**
 * POST /api/technician/work-orders/[workOrderId]/time
 *
 * Records a new manual time entry (BREAK or ADMIN) for the authenticated technician.
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

        const validatedInput = recordTechnicianTimeEntrySchema.parse(body);
        const entry = await recordTechnicianTimeEntry(techContext, workOrderId, validatedInput);

        return NextResponse.json(
            {
                success: true,
                data: entry,
            },
            { status: 201 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Record technician time entry");
    }
}
