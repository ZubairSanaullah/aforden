/**
 * Scheduling & Dispatch Domain-Specific Application Errors
 *
 * Pure domain exceptions representing business rule violations and precondition failures.
 * Each error class defines its canonical error code and mapped HTTP status code
 * for translation by upper-layer route handlers (Phase 1.8.1 §13).
 */

export class ScheduleAppointmentNotFoundError extends Error {
    readonly code = "SCHEDULE_APPOINTMENT_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Appointment not found in this workspace.") {
        super(message);
        this.name = "ScheduleAppointmentNotFoundError";
    }
}

export class ScheduleWorkOrderNotFoundError extends Error {
    readonly code = "SCHEDULE_WORK_ORDER_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Work order not found in this workspace.") {
        super(message);
        this.name = "ScheduleWorkOrderNotFoundError";
    }
}

export class ScheduleWorkOrderNotAssignedError extends Error {
    readonly code = "SCHEDULE_WORK_ORDER_NOT_ASSIGNED";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Work order is not assigned to a technician. Assign the work order before scheduling.",
    ) {
        super(message);
        this.name = "ScheduleWorkOrderNotAssignedError";
    }
}

export class ScheduleTechnicianMismatchError extends Error {
    readonly code = "SCHEDULE_TECHNICIAN_MISMATCH";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Appointment technician does not match the assigned technician on the work order.",
    ) {
        super(message);
        this.name = "ScheduleTechnicianMismatchError";
    }
}

export class ScheduleWorkOrderNotEligibleError extends Error {
    readonly code = "SCHEDULE_WORK_ORDER_NOT_ELIGIBLE";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Cannot schedule an appointment for a work order in a terminal status (COMPLETED or CANCELLED).",
    ) {
        super(message);
        this.name = "ScheduleWorkOrderNotEligibleError";
    }
}

export class ScheduleTechnicianNotFoundError extends Error {
    readonly code = "SCHEDULE_TECHNICIAN_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Technician profile not found in this workspace.") {
        super(message);
        this.name = "ScheduleTechnicianNotFoundError";
    }
}

export class ScheduleTechnicianNotEligibleError extends Error {
    readonly code = "SCHEDULE_TECHNICIAN_NOT_ELIGIBLE";
    readonly statusCode = 422;
    readonly httpStatus = 422;
    public readonly blockers: string[];

    constructor(
        message = "Technician is inactive, suspended, or not eligible for appointment scheduling.",
        blockers: string[] = [],
    ) {
        super(message);
        this.name = "ScheduleTechnicianNotEligibleError";
        this.blockers = blockers;
    }
}

export class ScheduleTechnicianOnLeaveError extends Error {
    readonly code = "SCHEDULE_TECHNICIAN_ON_LEAVE";
    readonly statusCode = 422;
    readonly httpStatus = 422;
    public readonly exceptions: any[];

    constructor(
        message = "Technician has an approved schedule exception (time off, sick leave, or training) during the requested time window.",
        exceptions: any[] = [],
    ) {
        super(message);
        this.name = "ScheduleTechnicianOnLeaveError";
        this.exceptions = exceptions;
    }
}

export class ScheduleOutsideWorkingHoursError extends Error {
    readonly code = "SCHEDULE_OUTSIDE_WORKING_HOURS";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Technician is scheduled outside configured weekly working hours.",
    ) {
        super(message);
        this.name = "ScheduleOutsideWorkingHoursError";
    }
}

export class ScheduleTechnicianActiveBookingsError extends Error {
    readonly code = "SCHEDULE_TECHNICIAN_ACTIVE_BOOKINGS";
    readonly statusCode = 409;
    readonly httpStatus = 409;
    public readonly activeCount: number;
    public readonly appointmentIds: string[];

    constructor(
        activeCount: number,
        appointmentIds: string[] = [],
        message = `Technician has ${activeCount} active future appointment(s). Reassign or cancel active appointments before deactivating technician.`,
    ) {
        super(message);
        this.name = "ScheduleTechnicianActiveBookingsError";
        this.activeCount = activeCount;
        this.appointmentIds = appointmentIds;
    }
}

export class ScheduleInvalidTimeIntervalError extends Error {
    readonly code = "SCHEDULE_INVALID_TIME_INTERVAL";
    readonly statusCode = 400;
    readonly httpStatus = 400;

    constructor(
        message = "Scheduled start time must be strictly earlier than end time.",
    ) {
        super(message);
        this.name = "ScheduleInvalidTimeIntervalError";
    }
}

export class ScheduleTechnicianConflictError extends Error {
    readonly code = "SCHEDULE_TECHNICIAN_CONFLICT";
    readonly statusCode = 409;
    readonly httpStatus = 409;
    public readonly conflicts: any[];

    constructor(
        message = "Technician already has an active overlapping appointment during the requested time window.",
        conflicts: any[] = [],
    ) {
        super(message);
        this.name = "ScheduleTechnicianConflictError";
        this.conflicts = conflicts;
    }
}

export class ScheduleInvalidStatusTransitionError extends Error {
    readonly code = "SCHEDULE_INVALID_STATUS_TRANSITION";
    readonly statusCode = 409;
    readonly httpStatus = 409;
    public readonly currentStatus?: string;
    public readonly requestedStatus?: string;

    constructor(
        message = "The requested appointment status transition is not permitted by the state machine.",
        currentStatus?: string,
        requestedStatus?: string,
    ) {
        super(message);
        this.name = "ScheduleInvalidStatusTransitionError";
        this.currentStatus = currentStatus;
        this.requestedStatus = requestedStatus;
    }
}

export class ScheduleImmutableError extends Error {
    readonly code = "SCHEDULE_IMMUTABLE";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Appointment is in a terminal status (CANCELLED or COMPLETED) and cannot be modified.",
    ) {
        super(message);
        this.name = "ScheduleImmutableError";
    }
}

export class ScheduleMissingCancellationReasonError extends Error {
    readonly code = "SCHEDULE_MISSING_CANCELLATION_REASON";
    readonly statusCode = 400;
    readonly httpStatus = 400;

    constructor(
        message = "Cancellation reason is required when cancelling an appointment.",
    ) {
        super(message);
        this.name = "ScheduleMissingCancellationReasonError";
    }
}

export class DispatchNotAllowedError extends Error {
    readonly code = "DISPATCH_NOT_ALLOWED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Appointment cannot be dispatched. Must be in SCHEDULED or RESCHEDULED status with no active conflicts.",
    ) {
        super(message);
        this.name = "DispatchNotAllowedError";
    }
}

export class UndispatchNotAllowedError extends Error {
    readonly code = "UNDISPATCH_NOT_ALLOWED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Appointment cannot be undispatched because technician has already begun field execution.",
    ) {
        super(message);
        this.name = "UndispatchNotAllowedError";
    }
}

export class ScheduleDeletionNotAllowedError extends Error {
    readonly code = "SCHEDULE_DELETION_NOT_ALLOWED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Appointment deletion is not permitted. Only un-dispatched draft appointments without audit dependencies can be deleted.",
    ) {
        super(message);
        this.name = "ScheduleDeletionNotAllowedError";
    }
}
