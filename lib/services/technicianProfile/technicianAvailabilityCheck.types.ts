import type {
    EmployeeStatus,
    AvailabilityDay,
    TechnicianExceptionType,
} from "@/generated/prisma/client";

export const TECHNICIAN_AVAILABILITY_BLOCKERS = [
    "INVALID_REQUESTED_INTERVAL",
    "EMPLOYEE_NOT_ACTIVE",
    "TECHNICIAN_PROFILE_MISSING",
    "NO_ACTIVE_SKILLS",
    "NO_ACTIVE_SERVICE_AREAS",
    "NO_RECURRING_AVAILABILITY",
    "OUTSIDE_RECURRING_AVAILABILITY",
    "BLOCKED_BY_EXCEPTION",
] as const;

export type TechnicianAvailabilityBlocker =
    (typeof TECHNICIAN_AVAILABILITY_BLOCKERS)[number];

export interface RecurringAvailabilityWindow {
    id: string;
    dayOfWeek: AvailabilityDay;
    startTime: string;
    endTime: string;
}

export interface BlockingExceptionInfo {
    id: string;
    type: TechnicianExceptionType;
    title: string;
    startsAt: Date;
    endsAt: Date;
    isAllDay: boolean;
}

export interface TechnicianAvailabilityCheck {
    isAvailable: boolean;

    technicianProfileId: string | null;
    employeeId: string;

    employeeStatus: EmployeeStatus;

    hasTechnicianProfile: boolean;
    hasActiveSkills: boolean;
    hasActiveServiceAreas: boolean;

    requestedInterval: {
        startsAt: Date;
        endsAt: Date;
    };

    recurringAvailability: RecurringAvailabilityWindow[];
    matchingAvailability: RecurringAvailabilityWindow[];
    blockingExceptions: BlockingExceptionInfo[];

    blockers: TechnicianAvailabilityBlocker[];
}
