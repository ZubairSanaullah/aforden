import { describe, expect, it } from "vitest";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleWorkOrderNotFoundError,
    ScheduleWorkOrderNotAssignedError,
    ScheduleTechnicianMismatchError,
    ScheduleWorkOrderNotEligibleError,
    ScheduleTechnicianNotFoundError,
    ScheduleTechnicianNotEligibleError,
    ScheduleInvalidTimeIntervalError,
    ScheduleTechnicianConflictError,
    ScheduleInvalidStatusTransitionError,
    ScheduleImmutableError,
    ScheduleMissingCancellationReasonError,
    DispatchNotAllowedError,
    UndispatchNotAllowedError,
    ScheduleDeletionNotAllowedError,
    ScheduleTechnicianOnLeaveError,
    ScheduleOutsideWorkingHoursError,
    ScheduleTechnicianActiveBookingsError,
} from "@/lib/services/schedule/scheduleErrors";

describe("Scheduling & Dispatch Error Taxonomy (§13)", () => {
    it("instantiates all 18 domain errors with correct codes and HTTP status codes", () => {
        const errors = [
            {
                instance: new ScheduleAppointmentNotFoundError(),
                name: "ScheduleAppointmentNotFoundError",
                code: "SCHEDULE_APPOINTMENT_NOT_FOUND",
                status: 404,
            },
            {
                instance: new ScheduleWorkOrderNotFoundError(),
                name: "ScheduleWorkOrderNotFoundError",
                code: "SCHEDULE_WORK_ORDER_NOT_FOUND",
                status: 404,
            },
            {
                instance: new ScheduleWorkOrderNotAssignedError(),
                name: "ScheduleWorkOrderNotAssignedError",
                code: "SCHEDULE_WORK_ORDER_NOT_ASSIGNED",
                status: 422,
            },
            {
                instance: new ScheduleTechnicianMismatchError(),
                name: "ScheduleTechnicianMismatchError",
                code: "SCHEDULE_TECHNICIAN_MISMATCH",
                status: 422,
            },
            {
                instance: new ScheduleWorkOrderNotEligibleError(),
                name: "ScheduleWorkOrderNotEligibleError",
                code: "SCHEDULE_WORK_ORDER_NOT_ELIGIBLE",
                status: 422,
            },
            {
                instance: new ScheduleTechnicianNotFoundError(),
                name: "ScheduleTechnicianNotFoundError",
                code: "SCHEDULE_TECHNICIAN_NOT_FOUND",
                status: 404,
            },
            {
                instance: new ScheduleTechnicianNotEligibleError("Tech suspended", ["STATUS_SUSPENDED"]),
                name: "ScheduleTechnicianNotEligibleError",
                code: "SCHEDULE_TECHNICIAN_NOT_ELIGIBLE",
                status: 422,
            },
            {
                instance: new ScheduleInvalidTimeIntervalError(),
                name: "ScheduleInvalidTimeIntervalError",
                code: "SCHEDULE_INVALID_TIME_INTERVAL",
                status: 400,
            },
            {
                instance: new ScheduleTechnicianConflictError("Conflict detected", [{ id: "apt_1" }]),
                name: "ScheduleTechnicianConflictError",
                code: "SCHEDULE_TECHNICIAN_CONFLICT",
                status: 409,
            },
            {
                instance: new ScheduleInvalidStatusTransitionError("Transition blocked", "COMPLETED", "SCHEDULED"),
                name: "ScheduleInvalidStatusTransitionError",
                code: "SCHEDULE_INVALID_STATUS_TRANSITION",
                status: 409,
            },
            {
                instance: new ScheduleImmutableError(),
                name: "ScheduleImmutableError",
                code: "SCHEDULE_IMMUTABLE",
                status: 409,
            },
            {
                instance: new ScheduleMissingCancellationReasonError(),
                name: "ScheduleMissingCancellationReasonError",
                code: "SCHEDULE_MISSING_CANCELLATION_REASON",
                status: 400,
            },
            {
                instance: new DispatchNotAllowedError(),
                name: "DispatchNotAllowedError",
                code: "DISPATCH_NOT_ALLOWED",
                status: 409,
            },
            {
                instance: new UndispatchNotAllowedError(),
                name: "UndispatchNotAllowedError",
                code: "UNDISPATCH_NOT_ALLOWED",
                status: 409,
            },
            {
                instance: new ScheduleDeletionNotAllowedError(),
                name: "ScheduleDeletionNotAllowedError",
                code: "SCHEDULE_DELETION_NOT_ALLOWED",
                status: 409,
            },
            {
                instance: new ScheduleTechnicianOnLeaveError("On leave", [{ id: "exc_1" }]),
                name: "ScheduleTechnicianOnLeaveError",
                code: "SCHEDULE_TECHNICIAN_ON_LEAVE",
                status: 422,
            },
            {
                instance: new ScheduleOutsideWorkingHoursError(),
                name: "ScheduleOutsideWorkingHoursError",
                code: "SCHEDULE_OUTSIDE_WORKING_HOURS",
                status: 422,
            },
            {
                instance: new ScheduleTechnicianActiveBookingsError(2, ["apt_1", "apt_2"]),
                name: "ScheduleTechnicianActiveBookingsError",
                code: "SCHEDULE_TECHNICIAN_ACTIVE_BOOKINGS",
                status: 409,
            },
        ];

        expect(errors).toHaveLength(18);

        for (const err of errors) {
            expect(err.instance).toBeInstanceOf(Error);
            expect(err.instance.name).toBe(err.name);
            expect(err.instance.code).toBe(err.code);
            expect(err.instance.statusCode).toBe(err.status);
            expect(err.instance.httpStatus).toBe(err.status);
            expect(err.instance.message).toBeTruthy();
        }
    });

    it("attaches blockers to ScheduleTechnicianNotEligibleError", () => {
        const err = new ScheduleTechnicianNotEligibleError("Ineligible", ["STATUS_SUSPENDED"]);
        expect(err.blockers).toEqual(["STATUS_SUSPENDED"]);
    });

    it("attaches exceptions to ScheduleTechnicianOnLeaveError", () => {
        const exc = [{ id: "exc_1", title: "Vacation" }];
        const err = new ScheduleTechnicianOnLeaveError("Leave", exc);
        expect(err.exceptions).toEqual(exc);
    });

    it("attaches conflicts array to ScheduleTechnicianConflictError", () => {
        const conflicts = [{ id: "apt_101", scheduledStart: new Date(), scheduledEnd: new Date() }];
        const err = new ScheduleTechnicianConflictError("Conflict", conflicts);
        expect(err.conflicts).toEqual(conflicts);
    });

    it("attaches status transition details to ScheduleInvalidStatusTransitionError", () => {
        const err = new ScheduleInvalidStatusTransitionError("Blocked", "COMPLETED", "SCHEDULED");
        expect(err.currentStatus).toBe("COMPLETED");
        expect(err.requestedStatus).toBe("SCHEDULED");
    });
});
