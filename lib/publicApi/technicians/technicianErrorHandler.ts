import { ZodError } from "zod";
import { jsonError } from "@/lib/publicApi/envelope";
import {
    TechnicianProfileNotFoundError,
    TechnicianProfileAlreadyExistsError,
    InvalidEmployeeError,
} from "@/lib/services/technicianProfile/technicianProfileErrors";

/**
 * Translates Technician domain exceptions and Zod validation errors into
 * canonical Public API error responses adhering to Section 7 of the architecture spec.
 */
export function handleTechnicianPublicApiError(
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

    if (error instanceof TechnicianProfileNotFoundError) {
        return jsonError("NOT_FOUND", "Technician not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof InvalidEmployeeError) {
        return jsonError("NOT_FOUND", "Employee not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof TechnicianProfileAlreadyExistsError) {
        return jsonError("CONFLICT", error.message, {
            status: 409,
            requestId,
        });
    }

    throw error;
}
