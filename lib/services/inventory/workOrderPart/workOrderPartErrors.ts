/**
 * Phase 1.10 WorkOrderPart Domain Errors
 * Convention B: Structured errors with readonly code, statusCode, and httpStatus.
 */

export class WorkOrderPartNotFoundError extends Error {
    readonly code = "WORK_ORDER_PART_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(
        message = "Work order part consumption record not found in authorized workspace.",
    ) {
        super(message);
        this.name = "WorkOrderPartNotFoundError";
    }
}
