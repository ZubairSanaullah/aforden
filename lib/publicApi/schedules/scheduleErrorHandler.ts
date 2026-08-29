import { ZodError } from "zod";
import { jsonError } from "@/lib/publicApi/envelope";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleWorkOrderNotFoundError,
    ScheduleTechnicianNotFoundError,
    ScheduleWorkOrderNotAssignedError,
    ScheduleTechnicianMismatchError,
    ScheduleTechnicianConflictError,
} from "@/lib/services/schedule/scheduleErrors";

/**
 * Translates Schedule domain exceptions and Zod validation errors into
 * canonical Public API error responses adhering to Section 7 of the architecture spec.
 */
export function handleSchedulePublicApiError(
    error: unknown,
    requestId?: string,
): Response {
    if (error instanceof ZodError) {
        const details = error.issues.map((issue) => ({
            field: issue.path.join("."),
            issue: issue.code.toUpperCase(),
            message: issue.message,
        }));

        return jsonError(
            "VALIDATION_ERROR",
            "The request query parameters failed validation constraints.",
            {
                status: 422,
                details,
                requestId,
            },
        );
    }

    if (error instanceof ScheduleAppointmentNotFoundError) {
        return jsonError("NOT_FOUND", "Schedule appointment not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof ScheduleWorkOrderNotFoundError) {
        return jsonError("NOT_FOUND", "Work order not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof ScheduleTechnicianNotFoundError) {
        return jsonError("NOT_FOUND", "Technician not found.", {
            status: 404,
            requestId,
        });
    }

    if (
        error instanceof ScheduleWorkOrderNotAssignedError ||
        error instanceof ScheduleTechnicianMismatchError
    ) {
        return jsonError("VALIDATION_ERROR", (error as Error).message, {
            status: 422,
            requestId,
        });
    }

    if (error instanceof ScheduleTechnicianConflictError) {
        return jsonError("CONFLICT", (error as Error).message, {
            status: 409,
            requestId,
        });
    }

    throw error;
}

