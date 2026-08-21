import { NextResponse } from "next/server";
import { getAppointmentHistory } from "@/lib/services/schedule";
import {
    extractWorkspaceId,
    mapScheduleErrorToResponse,
} from "@/lib/utils/scheduleApiError";

interface RouteContext {
    params: Promise<{
        scheduleId: string;
    }>;
}

/**
 * GET /api/schedules/[scheduleId]/history
 *
 * Retrieves chronological operational audit history for a single appointment.
 */
export async function GET(
    request: Request,
    context: RouteContext,
) {
    try {
        const { scheduleId } = await context.params;
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

        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const queryInput: Record<string, any> = {};

        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("limit")) queryInput.limit = searchParams.get("limit")!;

        const result = await getAppointmentHistory(workspaceId, scheduleId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "Get appointment history");
    }
}
