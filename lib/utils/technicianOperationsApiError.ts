import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization";
import {
    TechnicianProfileNotFoundError,
    TechnicianNotAssignedToWorkOrderError,
    ActiveTimeEntryExistsError,
    TimeEntryNotFoundError,
    TimeEntryImmutableError,
} from "@/lib/services/technicianOperations/technicianOperationsErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
    WorkOrderCompletionPreconditionFailedError,
    WorkOrderDeletionNotAllowedError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    ScheduleAppointmentNotFoundError,
    DispatchNotAllowedError,
    UndispatchNotAllowedError,
} from "@/lib/services/schedule/scheduleErrors";

/**
 * Extracts the tenant workspace ID from standard request headers or query parameters.
 * Deterministic precedence:
 * 1. x-workspace-id header
 * 2. workspace-id header
 * 3. ?workspaceId= query parameter
 */
export function extractWorkspaceId(request: Request): string | null {
    const headerX = request.headers.get("x-workspace-id")?.trim();
    if (headerX) return headerX;

    const header = request.headers.get("workspace-id")?.trim();
    if (header) return header;

    try {
        const queryParam = new URL(request.url).searchParams.get("workspaceId")?.trim();
        if (queryParam) return queryParam;
    } catch {
        // Fallback for relative or malformed URLs
    }

    return null;
}

/**
 * Maps technician operations domain errors, validation errors, and exceptions
 * to standard JSON error responses per Section 10 of Phase 1.9.1.
 */
export function mapTechnicianOperationsErrorToResponse(
    error: unknown,
    context?: string
): NextResponse {
    // 1. Authorization & Workspace Access Errors (401 / 403 / 404 for WorkspaceNotFound)
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) {
        return authResponse;
    }

    // 2. Schema / Validation Errors (422 Unprocessable Entity)
    if (error instanceof ZodError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "VALIDATION_ERROR",
                    message: "Invalid request data.",
                    fields: error.flatten().fieldErrors,
                },
            },
            { status: 422 }
        );
    }

    // 3. Technician Operations Domain Errors
    if (error instanceof TechnicianProfileNotFoundError) {
        return NextResponse.json(
            {
                error: {
                    code: "TECHNICIAN_PROFILE_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 }
        );
    }

    if (error instanceof TechnicianNotAssignedToWorkOrderError) {
        return NextResponse.json(
            {
                error: {
                    code: "TECHNICIAN_NOT_ASSIGNED_TO_WORK_ORDER",
                    message: error.message,
                },
            },
            { status: 403 }
        );
    }

    if (error instanceof ActiveTimeEntryExistsError) {
        return NextResponse.json(
            {
                error: {
                    code: "ACTIVE_TIME_ENTRY_EXISTS",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    if (error instanceof TimeEntryNotFoundError) {
        return NextResponse.json(
            {
                error: {
                    code: "TIME_ENTRY_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 }
        );
    }

    if (error instanceof TimeEntryImmutableError) {
        return NextResponse.json(
            {
                error: {
                    code: "TIME_ENTRY_IMMUTABLE",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    // 4. Integrated Domain Errors (WorkOrder, Schedule)
    if (error instanceof WorkOrderNotFoundError || error instanceof ScheduleAppointmentNotFoundError) {
        return NextResponse.json(
            {
                error: {
                    code: error instanceof WorkOrderNotFoundError ? "WORK_ORDER_NOT_FOUND" : "SCHEDULE_APPOINTMENT_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 }
        );
    }

    if (error instanceof WorkOrderInvalidStatusTransitionError) {
        return NextResponse.json(
            {
                error: {
                    code: "WORK_ORDER_INVALID_STATUS_TRANSITION",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    if (error instanceof WorkOrderCompletionPreconditionFailedError) {
        return NextResponse.json(
            {
                error: {
                    code: "WORK_ORDER_COMPLETION_PRECONDITION_FAILED",
                    message: error.message,
                },
            },
            { status: 422 }
        );
    }

    if (error instanceof WorkOrderDeletionNotAllowedError) {
        return NextResponse.json(
            {
                error: {
                    code: "WORK_ORDER_DELETION_NOT_ALLOWED",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    if (error instanceof DispatchNotAllowedError || error instanceof UndispatchNotAllowedError) {
        return NextResponse.json(
            {
                error: {
                    code: error instanceof DispatchNotAllowedError ? "DISPATCH_NOT_ALLOWED" : "UNDISPATCH_NOT_ALLOWED",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    // 5. Internal / Unexpected Errors (500)
    console.error(`[Aforden Technician Operations API] Unexpected error${context ? ` in ${context}` : ""}:`, error);
    return NextResponse.json(
        {
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "An unexpected error occurred while processing the technician operation.",
            },
        },
        { status: 500 }
    );
}
