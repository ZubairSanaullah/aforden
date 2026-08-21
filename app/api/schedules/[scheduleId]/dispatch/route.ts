import { NextResponse } from "next/server";
import { dispatchAppointment } from "@/lib/services/schedule";
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
 * POST /api/schedules/[scheduleId]/dispatch
 *
 * Dispatches an appointment to the assigned technician for field execution.
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

        let body = {};
        try {
            const text = await request.text();
            if (text.trim().length > 0) {
                body = JSON.parse(text);
            }
        } catch {
            throw new SyntaxError("Invalid JSON in request body.");
        }

        const appointment = await dispatchAppointment(workspaceId, scheduleId, body);

        return NextResponse.json(
            {
                success: true,
                data: appointment,
            },
            { status: 200 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "Dispatch appointment");
    }
}
