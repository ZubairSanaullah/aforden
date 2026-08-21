import { NextResponse } from "next/server";
import {
    listSchedules,
    createSchedule,
} from "@/lib/services/schedule";
import {
    extractWorkspaceId,
    mapScheduleErrorToResponse,
} from "@/lib/utils/scheduleApiError";

/**
 * GET /api/schedules
 *
 * Lists paginated, filtered, searched, and sorted appointments for the authorized workspace.
 */
export async function GET(request: Request) {
    try {
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

        if (searchParams.has("technicianId")) queryInput.technicianId = searchParams.get("technicianId")!;
        if (searchParams.has("workOrderId")) queryInput.workOrderId = searchParams.get("workOrderId")!;
        if (searchParams.has("customerId")) queryInput.customerId = searchParams.get("customerId")!;
        if (searchParams.has("locationId")) queryInput.locationId = searchParams.get("locationId")!;
        if (searchParams.has("status")) queryInput.status = searchParams.get("status")!;
        if (searchParams.has("dispatchStatus")) queryInput.dispatchStatus = searchParams.get("dispatchStatus")!;
        if (searchParams.has("startDate")) queryInput.startDate = searchParams.get("startDate")!;
        if (searchParams.has("endDate")) queryInput.endDate = searchParams.get("endDate")!;
        if (searchParams.has("search")) queryInput.search = searchParams.get("search")!;
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("limit")) queryInput.limit = searchParams.get("limit")!;
        if (searchParams.has("sortBy")) queryInput.sortBy = searchParams.get("sortBy")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const result = await listSchedules(workspaceId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "List schedules");
    }
}

/**
 * POST /api/schedules
 *
 * Creates a new ScheduleAppointment under the authorized workspace.
 */
export async function POST(request: Request) {
    try {
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

        const appointment = await createSchedule(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: appointment,
            },
            { status: 201 },
        );
    } catch (error) {
        return mapScheduleErrorToResponse(error, "Create schedule");
    }
}
