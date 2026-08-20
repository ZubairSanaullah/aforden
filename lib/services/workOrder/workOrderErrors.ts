/**
 * WorkOrder domain-specific application errors.
 *
 * Pure domain errors without HTTP status codes.
 * Higher-level route handlers translate these into appropriate HTTP responses.
 */

export class WorkOrderNotFoundError extends Error {
    constructor(message = "Work order not found.") {
        super(message);
        this.name = "WorkOrderNotFoundError";
    }
}

export class WorkOrderCustomerNotFoundError extends Error {
    constructor(message = "Customer not found.") {
        super(message);
        this.name = "WorkOrderCustomerNotFoundError";
    }
}

export class WorkOrderCustomerInactiveError extends Error {
    constructor(
        message = "Cannot create work order for an inactive customer.",
    ) {
        super(message);
        this.name = "WorkOrderCustomerInactiveError";
    }
}

export class WorkOrderLocationNotFoundError extends Error {
    constructor(message = "Service location not found.") {
        super(message);
        this.name = "WorkOrderLocationNotFoundError";
    }
}

export class WorkOrderTechnicianNotFoundError extends Error {
    constructor(message = "Technician not found.") {
        super(message);
        this.name = "WorkOrderTechnicianNotFoundError";
    }
}

export class WorkOrderTechnicianNotEligibleError extends Error {
    constructor(
        message = "Technician is inactive, suspended, or not eligible for assignment.",
    ) {
        super(message);
        this.name = "WorkOrderTechnicianNotEligibleError";
    }
}

export class WorkOrderInvalidStatusTransitionError extends Error {
    constructor(
        message = "The requested work order status transition is not permitted.",
    ) {
        super(message);
        this.name = "WorkOrderInvalidStatusTransitionError";
    }
}

export class WorkOrderMissingHoldReasonError extends Error {
    constructor(
        message = "Hold reason is required when transitioning to ON_HOLD.",
    ) {
        super(message);
        this.name = "WorkOrderMissingHoldReasonError";
    }
}

export class WorkOrderMissingCancellationReasonError extends Error {
    constructor(
        message = "Cancellation reason is required when transitioning to CANCELLED.",
    ) {
        super(message);
        this.name = "WorkOrderMissingCancellationReasonError";
    }
}

export class WorkOrderAssignmentNotAllowedError extends Error {
    constructor(
        message = "Cannot assign a technician to a completed or cancelled work order.",
    ) {
        super(message);
        this.name = "WorkOrderAssignmentNotAllowedError";
    }
}

export class WorkOrderCompletionPreconditionFailedError extends Error {
    constructor(
        message = "Cannot complete work order. A technician must be assigned and work order must be in progress.",
    ) {
        super(message);
        this.name = "WorkOrderCompletionPreconditionFailedError";
    }
}

export class WorkOrderCancellationNotAllowedError extends Error {
    constructor(
        message = "Cannot cancel an already completed work order.",
    ) {
        super(message);
        this.name = "WorkOrderCancellationNotAllowedError";
    }
}

export class WorkOrderImmutableError extends Error {
    constructor(
        message = "Work order is in a terminal state (COMPLETED or CANCELLED) and cannot be modified.",
    ) {
        super(message);
        this.name = "WorkOrderImmutableError";
    }
}

export class WorkOrderDeletionNotAllowedError extends Error {
    constructor(
        message = "Work order deletion is not permitted. Only OPEN or CANCELLED work orders can be deleted.",
    ) {
        super(message);
        this.name = "WorkOrderDeletionNotAllowedError";
    }
}

export class DuplicateWorkOrderReferenceError extends Error {
    constructor(
        message = "A work order with this reference number already exists in this workspace.",
    ) {
        super(message);
        this.name = "DuplicateWorkOrderReferenceError";
    }
}

export class WorkOrderAssetCustomerMismatchError extends Error {
    readonly code = "WORK_ORDER_ASSET_CUSTOMER_MISMATCH";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Asset belongs to a different customer than the work order.",
    ) {
        super(message);
        this.name = "WorkOrderAssetCustomerMismatchError";
    }
}

export class WorkOrderAssetLocationMismatchError extends Error {
    readonly code = "WORK_ORDER_ASSET_LOCATION_MISMATCH";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Asset is located at a different service location than the work order.",
    ) {
        super(message);
        this.name = "WorkOrderAssetLocationMismatchError";
    }
}
