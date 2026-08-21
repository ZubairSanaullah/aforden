import { NextResponse } from "next/server";
import { getTechnicianSchedule } from "@/lib/services/schedule";
import {
    extractWorkspaceId,
    mapScheduleErrorToResponse,
} from "@/lib/utils/scheduleApiError";

interface RouteContext {
    params: Promise<{
        technicianId: string;
    }>;
}

/**
 * GET /api/technicians/[technicianId]/schedule
 *
 * Retrieves scheduled appointments for a specific technician within a time window.
 */
export async function GET(
    request: Request,
    context: RouteContext,
) {
    try {
        const { technicianId } = await context.params;
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

        if (searchParams.has("startDate")) queryInput.startDate = searchParams.get("startDate")!;
        if (searchParams.has("endDate")) queryInput.endDate = searchParams.get("endDate")!;
        if (searchParams.has("includeCancelled")) {
            queryInput.includeCancelled = searchParams.get("includeCancelled") === "true";
        }

        const result = await getTechnicianSchedule(workspaceId, technicianId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "Get technician schedule");
    }
}
