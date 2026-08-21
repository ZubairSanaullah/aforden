import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleWorkOrderNotFoundError,
    ScheduleWorkOrderNotAssignedError,
    ScheduleTechnicianMismatchError,
    ScheduleWorkOrderNotEligibleError,
    ScheduleTechnicianNotFoundError,
    ScheduleTechnicianNotEligibleError,
    ScheduleTechnicianOnLeaveError,
    ScheduleOutsideWorkingHoursError,
    ScheduleTechnicianActiveBookingsError,
    ScheduleInvalidTimeIntervalError,
    ScheduleTechnicianConflictError,
    ScheduleInvalidStatusTransitionError,
    ScheduleImmutableError,
    ScheduleMissingCancellationReasonError,
    DispatchNotAllowedError,
    UndispatchNotAllowedError,
    ScheduleDeletionNotAllowedError,
} from "@/lib/services/schedule/scheduleErrors";

/**
 * Extracts the tenant workspace ID from standard request headers or query parameters.
 * Precedence:
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
 * Maps any scheduling domain error, validation error, syntax error, or unexpected exception
 * to its standard JSON error response (§13 taxonomy).
 */
export function mapScheduleErrorToResponse(
    error: unknown,
    context?: string,
): NextResponse {
    // 1. Authorization & Workspace Access Errors (401 / 403)
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
            { status: 422 },
        );
    }

    // 3. Syntax Errors in JSON Body (400 Bad Request)
    if (error instanceof SyntaxError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: "Invalid JSON in request body.",
                },
            },
            { status: 400 },
        );
    }

    // 4. Domain Errors (§13 Taxonomy - 18 Error Classes)
    if (error instanceof ScheduleAppointmentNotFoundError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 404 },
        );
    }

    if (error instanceof ScheduleWorkOrderNotFoundError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 404 },
        );
    }

    if (error instanceof ScheduleTechnicianNotFoundError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 404 },
        );
    }

    if (error instanceof ScheduleWorkOrderNotAssignedError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 422 },
        );
    }

    if (error instanceof ScheduleTechnicianMismatchError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 422 },
        );
    }

    if (error instanceof ScheduleWorkOrderNotEligibleError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 422 },
        );
    }

    if (error instanceof ScheduleTechnicianNotEligibleError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    blockers: error.blockers,
                },
            },
            { status: 422 },
        );
    }

    if (error instanceof ScheduleTechnicianOnLeaveError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    exceptions: error.exceptions,
                },
            },
            { status: 422 },
        );
    }

    if (error instanceof ScheduleOutsideWorkingHoursError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 422 },
        );
    }

    if (error instanceof ScheduleTechnicianActiveBookingsError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    activeCount: error.activeCount,
                    appointmentIds: error.appointmentIds,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof ScheduleInvalidTimeIntervalError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 400 },
        );
    }

    if (error instanceof ScheduleMissingCancellationReasonError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 400 },
        );
    }

    if (error instanceof ScheduleTechnicianConflictError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    conflicts: error.conflicts,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof ScheduleInvalidStatusTransitionError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error.code,
                    message: error.message,
                    currentStatus: error.currentStatus,
                    requestedStatus: error.requestedStatus,
                },
            },
            { status: 409 },
        );
    }

    if (error instanceof ScheduleImmutableError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 409 },
        );
    }

    if (error instanceof DispatchNotAllowedError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 409 },
        );
    }

    if (error instanceof UndispatchNotAllowedError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 409 },
        );
    }

    if (error instanceof ScheduleDeletionNotAllowedError) {
        return NextResponse.json(
            { success: false, error: { code: error.code, message: error.message } },
            { status: 409 },
        );
    }

    // 5. Generic / Duck-typed Domain Error
    if (error && typeof error === "object" && "code" in error && ("statusCode" in error || "httpStatus" in error)) {
        const anyErr = error as any;
        const status = anyErr.statusCode || anyErr.httpStatus || 500;
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: anyErr.code,
                    message: anyErr.message || "An error occurred.",
                },
            },
            { status },
        );
    }

    // 6. Sanitized Internal Server Error (500)
    console.error(`[Scheduling API Error] ${context ? `[${context}] ` : ""}`, error);
    return NextResponse.json(
        {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "An unexpected error occurred. Please try again later.",
            },
        },
        { status: 500 },
    );
}

export const handleScheduleApiError = mapScheduleErrorToResponse;
