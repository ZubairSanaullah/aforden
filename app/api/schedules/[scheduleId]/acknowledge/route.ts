import { NextResponse } from "next/server";
import { acknowledgeDispatch } from "@/lib/services/schedule";
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
 * POST /api/schedules/[scheduleId]/acknowledge
 *
 * Acknowledges receipt of dispatch by the assigned technician (Phase 1.9 entry point).
 * Identity Scoping: Enforced strictly from the caller's session context by the service layer.
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

        const appointment = await acknowledgeDispatch(workspaceId, scheduleId, body);

        return NextResponse.json(
            {
                success: true,
                data: appointment,
            },
            { status: 200 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "Acknowledge dispatch");
    }
}
