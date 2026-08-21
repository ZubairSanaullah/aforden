import { NextResponse } from "next/server";
import {
    getSchedule,
    updateSchedule,
} from "@/lib/services/schedule";
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
 * GET /api/schedules/[scheduleId]
 *
 * Retrieves canonical read model for a single ScheduleAppointment.
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

        const appointment = await getSchedule(workspaceId, scheduleId);

        return NextResponse.json(
            {
                success: true,
                data: appointment,
            },
            { status: 200 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "Get schedule");
    }
}

/**
 * PATCH /api/schedules/[scheduleId]
 *
 * Updates non-temporal metadata (notes, metadata) for a single ScheduleAppointment.
 */
export async function PATCH(
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

        const appointment = await updateSchedule(workspaceId, scheduleId, body);

        return NextResponse.json(
            {
                success: true,
                data: appointment,
            },
            { status: 200 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "Update schedule");
    }
}
