import { NextResponse } from "next/server";
import { cancelSchedule } from "@/lib/services/schedule";
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
 * POST /api/schedules/[scheduleId]/cancel
 *
 * Cancels an appointment with mandatory reason tracking.
 */
export async function POST(
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

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const appointment = await cancelSchedule(workspaceId, scheduleId, body);

        return NextResponse.json(
            {
                success: true,
                data: appointment,
            },
            { status: 200 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "Cancel appointment");
    }
}
